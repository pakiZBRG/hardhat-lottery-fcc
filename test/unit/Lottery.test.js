const { assert, expect } = require("chai");
const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Lottery", async () => {
      let lottery, vrfCoordinatorV2Mock, lotteryEntranceFee, deployer, interval;
      const { chainId } = network.config;

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        lottery = await ethers.getContract("Lottery", deployer);
        vrfCoordinatorV2Mock = await ethers.getContract(
          "VRFCoordinatorV2Mock",
          deployer
        );
        lotteryEntranceFee = await lottery.getEntranceFee();
        interval = await lottery.getInterval();
      });

      describe("constructor", async () => {
        it("initializes the lottery correctly", async () => {
          const lotteryState = await lottery.getLotteryState();
          assert.equal(lotteryState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });

      describe("enterLottery", async () => {
        it("revert when you don't pay enough", async () => {
          await expect(lottery.enterLottery()).to.be.revertedWith(
            "Lottery__NotEnoughEther"
          );
        });
        it("records players when they enter", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          const playerFromContract = await lottery.getPlayer(0);
          assert.equal(playerFromContract, deployer);
        });
        it("emits event on enter", async () => {
          await expect(
            lottery.enterLottery({ value: lotteryEntranceFee })
          ).to.emit(lottery, "LotteryEnter");
        });
        it("doesn't allow entrance when lottery is calculating", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          // mock the passage of time, so we don't have to wait
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
          // We pretend to be Chainlink Keeper
          await lottery.performUpkeep([]);
          await expect(
            lottery.enterLottery({ value: lotteryEntranceFee })
          ).to.be.revertedWith("Lottery__NotOpen");
        });
      });

      describe("checkUpkeep", async () => {
        it("returns false if people haven't sent any ETH", async () => {
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
          // callStatic - calls a function, but doesn't initiate a tx
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });
        it("returns false if lottery is not open", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
          await lottery.performUpkeep("0x"); // 0x is same as []
          const lotteryState = await lottery.getLotteryState();
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);

          assert.equal(lotteryState.toString(), "1");
          assert.equal(upkeepNeeded, false);
        });
        it("returns false if enough time hasn't passed", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [+interval - 1]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(!upkeepNeeded);
        });
        it("returns true if enough time has passed, has players, ETH and is open", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([]);
          assert(upkeepNeeded);
        });
      });

      describe("performUpkeep", () => {
        it("can only run is checkupKeep is only true", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
          const tx = await lottery.performUpkeep([]);
          assert(tx);
        });
        it("reverts when checkUpkeep fails", async () => {
          const balance = await lottery.provider.getBalance(lottery.address);
          const numPlayers = await lottery.getNumberOfPlayers();
          const lotteryState = await lottery.getLotteryState();
          await expect(lottery.performUpkeep([])).to.be.revertedWith(
            `Lottery__UpkeepNotNeeded(${balance}, ${numPlayers}, ${lotteryState})`
          );
        });
        it("updates lottery state, emits an event and calls the VRF coordinator", async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
          const txResponse = await lottery.performUpkeep([]);
          const txReceipt = await txResponse.wait(1);
          const requestId = txReceipt.events[1].args.requestId;
          const lotteryState = await lottery.getLotteryState();

          assert(+requestId > 0);
          assert(lotteryState.toString() == "1");
        });
      });

      describe("fulfillRandomWords", async () => {
        beforeEach(async () => {
          await lottery.enterLottery({ value: lotteryEntranceFee });
          await network.provider.send("evm_increaseTime", [+interval + 1]);
          await network.provider.send("evm_mine", []);
        });

        it("can only be called after performUpkeep", async () => {
          // node_modules/@chainlink/src/v0.8/VRFConsumerBaseV2.sol/fulfillRandomWords(requestId, randomWords)
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)
          ).to.be.revertedWith("nonexistent request");
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)
          ).to.be.revertedWith("nonexistent request");
        });

        it("picks a winner, resets the lottery, and sends money", async () => {
          // add 3 additional mock entrance to a lottery => 4 people in total
          const additionalEntrants = 3;
          const startingAccountIndex = 1; // deployer = 0
          const accounts = await ethers.getSigners();
          for (
            let i = startingAccountIndex;
            i < startingAccountIndex + additionalEntrants;
            i++
          ) {
            const accountConnectedLottery = lottery.connect(accounts[i]);
            await accountConnectedLottery.enterLottery({
              value: lotteryEntranceFee,
            });
          }
          const staringTimeStamp = await lottery.getTimeStamp();

          // performUpkeep => mock being Chainlink Keepers
          // fulfillRandomWords => mock being the Chainlink VRF
          // We will have to wait for the fulfillRandomWords to be called => we need a new Promise
          await new Promise(async (resolve, reject) => {
            // listen for event
            lottery.once("WinnerPicked", async () => {
              try {
                const lotteryState = await lottery.getLotteryState();
                const endingTimeStamp = await lottery.getTimeStamp();
                const numPlayers = await lottery.getNumberOfPlayers();
                const winnerEndingBalance = await accounts[1].getBalance();

                assert.equal(numPlayers, 0);
                assert.equal(lotteryState.toString(), "0");
                assert(endingTimeStamp > staringTimeStamp);

                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(
                    lotteryEntranceFee
                      .mul(additionalEntrants)
                      .add(lotteryEntranceFee)
                      .toString()
                  )
                );
              } catch (e) {
                reject(e);
              }
              resolve();
            });

            // fire the event, ^ it will be delt with
            // only for the testnet, we are pretending we are Chainlink Keeper
            const tx = await lottery.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const winnerStartingBalance = await accounts[1].getBalance();
            await vrfCoordinatorV2Mock.fulfillRandomWords(
              txReceipt.events[1].args.requestId,
              lottery.address
            );
          });
        });
      });
    });
