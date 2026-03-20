require('dotenv').config();

// ── Validate required env vars at startup ────────────────────────────────────
const REQUIRED_ENV = ['DISCORD_TOKEN', 'DISCORD_CHANNEL_ID', 'DISCORD_GUILD_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');
const http = require('http');
const { runClaude } = require('./claude');
const { getHistory, appendMessage, resetContext, formatPrompt } = require('./context');

// ── Health check HTTP server (required by Coolify) ──────────────────────────
const healthServer = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});
healthServer.listen(3000, () => console.log('Health check listening on :3000'));

// ── Message splitting ────────────────────────────────────────────────────────
const MAX_LEN = 2000;

function splitMessage(text) {
  if (text.length <= MAX_LEN) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      parts.push(remaining);
      break;
    }
    const cut = remaining.lastIndexOf(' ', MAX_LEN);
    const splitAt = cut > 0 ? cut : MAX_LEN;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return parts;
}

// ── Discord client ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// Register slash commands once bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const commands = [
      new SlashCommandBuilder()
        .setName('new')
        .setDescription('Reset your conversation context with Claude')
        .toJSON()
    ];

    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
      { body: commands }
    );
    console.log('Slash commands registered');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

// Handle /new slash command
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'new') {
    try {
      resetContext(interaction.user.id);
      await interaction.reply({
        content: 'Your conversation context has been reset.',
        ephemeral: true
      });
    } catch (err) {
      console.error('Error handling /new interaction:', err);
    }
  }
});

// Handle messages
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const inDedicatedChannel = message.channelId === process.env.DISCORD_CHANNEL_ID;
  const isMentioned = message.mentions.has(client.user);

  if (!inDedicatedChannel && !isMentioned) return;

  // Strip all @mentions from message content
  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (!content) return;

  // Refresh typing indicator every 9s for responses that take longer than 10s
  const typingInterval = setInterval(() => message.channel.sendTyping(), 9000);
  await message.channel.sendTyping();

  try {
    const history = getHistory(message.author.id);
    const prompt = formatPrompt(history, content);
    const response = await runClaude(prompt);

    appendMessage(message.author.id, 'user', content);
    appendMessage(message.author.id, 'assistant', response);

    const parts = splitMessage(response);
    for (const part of parts) {
      await message.reply(part);
    }
  } catch (err) {
    console.error('Error running claude:', err);
    await message.reply('Something went wrong. Please try again.');
  } finally {
    clearInterval(typingInterval);
  }
});

client.login(process.env.DISCORD_TOKEN);
