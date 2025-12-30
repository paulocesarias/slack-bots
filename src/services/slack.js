const { WebClient } = require('@slack/web-api');

async function createChannel(token, channelName) {
  const client = new WebClient(token);

  try {
    // Try to create the channel
    const result = await client.conversations.create({
      name: channelName,
      is_private: false
    });

    return {
      success: true,
      channel: {
        id: result.channel.id,
        name: result.channel.name
      }
    };
  } catch (error) {
    // Check if channel already exists
    if (error.data?.error === 'name_taken') {
      // Try to find the existing channel
      const channels = await client.conversations.list({
        types: 'public_channel,private_channel'
      });

      const existing = channels.channels.find(c => c.name === channelName);
      if (existing) {
        return {
          success: true,
          channel: {
            id: existing.id,
            name: existing.name
          },
          existed: true
        };
      }
    }

    throw new Error(`Failed to create Slack channel: ${error.message}`);
  }
}

async function validateToken(token) {
  const client = new WebClient(token);

  try {
    const result = await client.auth.test();
    return {
      valid: true,
      team: result.team,
      user: result.user,
      botId: result.bot_id
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

async function postMessage(token, channelId, message) {
  const client = new WebClient(token);

  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      text: message
    });

    return {
      success: true,
      ts: result.ts
    };
  } catch (error) {
    throw new Error(`Failed to post message: ${error.message}`);
  }
}

async function inviteToChannel(token, channelId, userId) {
  const client = new WebClient(token);

  try {
    await client.conversations.invite({
      channel: channelId,
      users: userId
    });

    return { success: true };
  } catch (error) {
    // Ignore "already_in_channel" error
    if (error.data?.error === 'already_in_channel') {
      return { success: true, alreadyMember: true };
    }
    throw new Error(`Failed to invite to channel: ${error.message}`);
  }
}

module.exports = {
  createChannel,
  validateToken,
  postMessage,
  inviteToChannel
};
