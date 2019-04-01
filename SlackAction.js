const PulseSdk = require('@qasymphony/pulse-sdk');

// @pure
const getPayload = body => {
    const text = JSON.stringify(body);
    return {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "text": text })
    }
}

// Entry point to the script
// @impure: reliant on network and uses I/O
exports.handler = async function({ event: body, constants, triggers }, context, callback) {
    console.log('About to request slack webhook: ', constants.SlackWebHook);

    try {
        const response = await fetch(constants.SlackWebHook, getPayload(body));
        console.log("URL:", response.url, "Status:", response.status, "Status Text:", response.statusText);
    } catch (error) {
        console.log("Caught Error:", error);
        throw error;
    }
}