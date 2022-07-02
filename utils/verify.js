const { run } = require("hardhat")

module.exports = async (contractAddress, args) => {
    try {
        await run('verify:verify', {
            address: contractAddress,
            constructorArguments: args
        })
    } catch(error) {
        if(error.message.toLowerCase().includes("already verified")) {
            console.log("Already verified!");
        } else {
            console.log("Error during veryfing", error.message);
        }
    }
}