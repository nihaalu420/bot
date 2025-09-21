const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const mcDataLib = require('minecraft-data');
const express = require('express');
const config = require('./settings.json');

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(8000, () => {
  console.log('Server started');
});

function createBot() {
  console.log('Starting bot...');

  // Set auth type based on config or default to 'offline' for cracked
  const authType = config['bot-account']['type'] || 'offline';

  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: authType, // 'offline' for cracked accounts
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
    colorsEnabled: false // ✅ fix colorsEnabled crash
  });

  bot.loadPlugin(pathfinder);
  const mcData = mcDataLib(bot.version);
  const defaultMove = new Movements(bot, mcData);

  let pendingPromise = Promise.resolve();

  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register command.`);

      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);
        if (message.includes('successfully registered') || message.includes('already registered')) {
          resolve();
        } else {
          reject(`Registration failed: ${message}`);
        }
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login command.`);

      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);
        if (message.includes('successfully logged in')) resolve();
        else reject(`Login failed: ${message}`);
      });
    });
  }

  bot.once('spawn', () => {
    console.log('\x1b[33m[AfkBot] Bot joined the server\x1b[0m');

    if (config.utils['auto-auth']?.enabled) {
      console.log('[INFO] Started auto-auth module');
      const password = config.utils['auto-auth'].password;

      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error));
    }

    if (config.utils['chat-messages']?.enabled) {
      console.log('[INFO] Started chat-messages module');
      const messages = config.utils['chat-messages'].messages;
      if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;
        setInterval(() => {
          bot.chat(messages[i]);
          i = (i + 1) % messages.length;
        }, delay * 1000);
      } else {
        messages.forEach(msg => bot.chat(msg));
      }
    }

    const pos = config.position;
    if (pos?.enabled) {
      console.log(`\x1b[32m[AfkBot] Moving to (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    if (config.utils['anti-afk']?.enabled) {
      bot.setControlState('jump', true);
      if (config.utils['anti-afk'].sneak) bot.setControlState('sneak', true);
    }
  });

  bot.on('goal_reached', () => {
    console.log(`\x1b[32m[AfkBot] Arrived at target: ${bot.entity.position}\x1b[0m`);
  });

  bot.on('death', () => {
    console.log(`\x1b[33m[AfkBot] Died & respawned at ${bot.entity.position}\x1b[0m`);
  });

  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log('[INFO] Bot disconnected. Reconnecting...');
      setTimeout(() => {
        createBot();
      }, config.utils['auto-reconnect-delay'] || 5000);
    });
  }

  bot.on('kicked', (reason) => {
    console.log(`\x1b[33m[AfkBot] Kicked. Reason: ${reason}\x1b[0m`);
  });

  bot.on('error', (err) => {
    console.log(`\x1b[31m[ERROR] ${err.message}\x1b[0m`);
  });
}

createBot();
