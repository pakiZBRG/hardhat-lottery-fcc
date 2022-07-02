const { ethers, network } = require("hardhat");
const path = require('path');
const fs = require('fs');

const FRONT_END_ADDRESSES_PATH = path.join(__dirname, '../../nextjs-lottery/constants/contractAddress.json')
const FRONT_END_ABI_PATH = path.join(__dirname, '../../nextjs-lottery/constants/abi.json')

module.exports = async () => {
    if(process.env.UPDATE_FRONTEND) {
        console.log("Updating front end...");
        await updateContractAddresses();
        updateABI();
    }
}

const updateContractAddresses = async() => {
    const chainId = network.config.chainId.toString();
    const lottery = await ethers.getContract('Lottery');
    const contractAddresses = JSON.parse(fs.readFileSync(FRONT_END_ADDRESSES_PATH, "utf8"))

    if(chainId in contractAddresses) {
        if(!contractAddresses[chainId].includes(lottery.address)){
            contractAddresses[chainId].push(lottery.address);
        }
    } else {
        contractAddresses[chainId] = [lottery.address]
    }

    fs.writeFileSync(FRONT_END_ADDRESSES_PATH, JSON.stringify(contractAddresses))
}

const updateABI = async  () => {
    const lottery = await ethers.getContract("Lottery")
    fs.writeFileSync(FRONT_END_ABI_PATH, lottery.interface.format(ethers.utils.FormatTypes.json))
}

module.exports.tags = ["all", "frontend"];