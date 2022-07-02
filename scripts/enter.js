const { ethers } = require("hardhat");

const enterLottery = async () => {
  const lottery = await ethers.getContract("Lottery");
  const entranceFee = await lottery.getEntranceFee();
  const tx = await lottery.enterLottery({ value: entranceFee + 1 });
  await tx.wait(1);
  console.log("Entered");
};

enterLottery()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
