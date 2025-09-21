const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const mcDataLib = require('minecraft-data');
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (req, res) => res.send('Bot has arrived'));
app.listen(8000, () => console.log('Server started'));

let reconnectAttempts = 0;
const MAX_RECONNECTS = 5;

function createBot() {
  console.log('Starting bot...');

  const authType = config['bot-account']['type'] || 'offline';

  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: authType,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version,
    colorsEnabled: false
  });

  bot.loadPlugin(pathfinder);
  const mcData = mcDataLib(bot.version);
  const defaultMove = new Movements(bot, mcData);

  let pendingPromise = Promise.resolve();

  // --- Auto Auth ---
  function sendRegister(password) {
    return new Promise((resolve, reject) => {
      if (!bot.connected) return reject('Bot not connected');
      bot.chat(`/register ${password} ${password}`);
      console.log(`[Auth] Sent /register`);
      bot.once('chat', (username, message) => {
        console.log(`[ChatLog] <${username}> ${message}`);
        if (message.includes('successfully registered') || message.includes('already registered')) resolve();
        else reject(`Registration failed: ${message}`);
      });
    });
  }

  function sendLogin(password) {
    return new Promise((resolve, reject) => {
      if (!bot.connected) return reject('Bot not connected');
      bot.chat(`/login ${password}`);
      console.log(`[Auth] Sent /login`);
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
      const password = config.utils['auto-auth'].password;
      pendingPromise = pendingPromise
        .then(() => sendRegister(password))
        .then(() => sendLogin(password))
        .catch(error => console.error('[ERROR]', error));
    }

    // --- Chat messages ---
    if (config.utils['chat-messages']?.enabled) {
      const messages = config.utils['chat-messages'].messages || [];
      if (config.utils['chat-messages'].repeat) {
        let i = 0;
        const delay = config.utils['chat-messages']['repeat-delay'] || 10;
        setInterval(() => {
          if (bot.connected && messages.length) bot.chat(messages[i]);
          i = (i + 1) % messages.length;
        }, delay * 1000);
      } else {
        messages.forEach(msg => bot.connected && bot.chat(msg));
      }
    }

    // --- Movement to position ---
    const pos = config.position;
    if (pos?.enabled && bot.connected) {
      console.log(`\x1b[32m[AfkBot] Moving to (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`);
      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
    }

    // --- Anti-AFK ---
    if (config.utils['anti-afk']?.enabled && bot.connected) {
      bot.setControlState('jump', true);
      if (config.utils['anti-afk'].sneak) bot.setControlState('sneak', true);

      // Front-back movement loop
      let movingForward = true;
      setInterval(() => {
        if (!bot.connected) return;
        if (movingForward) {
          bot.setControlState('forward', true);
          bot.setControlState('back', false);
        } else {
          bot.setControlState('forward', false);
          bot.setControlState('back', true);
        }
        movingForward = !movingForward;
      }, 3000); // change direction every 3 seconds
    }
  });

  bot.on('goal_reached', () => {
    console.log(`\x1b[32m[AfkBot] Arrived at target: ${bot.entity.position}\x1b[0m`);
  });

  bot.on('death', () => {
    console.log(`\x1b[33m[AfkBot] Died & respawned at ${bot.entity.position}\x1b[0m`);
  });

  bot.on('kicked', (reason) => {
    console.log(`\x1b[33m[AfkBot] Kicked. Reason: ${reason}\x1b[0m`);
  });

  bot.on('error', (err) => {
    console.log(`\x1b[31m[ERROR] ${err.message}\x1b[0m`);
  });

  bot.on('end', () => {
    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECTS) {
      console.log('[ERROR] Max reconnect attempts reached. Stopping bot.');
      return;
    }
    console.log(`[INFO] Bot disconnected. Reconnecting in 15s... (Attempt ${reconnectAttempts}/${MAX_RECONNECTS})`);
    setTimeout(() => createBot(), 15000);
  });

  // --- Catch unhandled exceptions to prevent EPIPE crash ---
  process.on('uncaughtException', (err) => {
    console.error('[FATAL]', err);
  });
}

createBot();
