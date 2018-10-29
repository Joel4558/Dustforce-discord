/*
  Requirements for running this:
    A file named tokens.js in the parent directory of this file with the following content:
      module.exports = {
        "twitch-client-id": 'client-id', // Client ID from the twitch website in the developers section.
        "discord": 'token', // Client token from the discord website in the developers section.
        "twitter": {
          "consumer_key": 'key',
          "consumer_secret": 'secret',
          "access_token": 'token',
          "access_token_secret": 'secret'
        }
      }
    Dependencies from npm:
      discord.js,
      twitch-helix-api
      twit
    Highly recommended:
      Proxy the websocket server with SSL (nginx works well for me), or at the very least google the ws library and figure out how to implement SSL.
*/
const Discord = require('discord.js');
const dustforceDiscord = new Discord.Client();
const token = require('./../tokens')["dustforce-discord"];
const twitter_credentials = require('./../tokens')["twitter"];
const twitch = require('./twitch-helix');
const replays = require('./replays');
/*const EventEmitter = require('events');
const replays = new EventEmitter();
const twitch = new EventEmitter();*/
const replayTools = require('./replayTools');
const request = require('./request');
const querystring = require('querystring');
const Twit = require('twit');
const twitter = new Twit(twitter_credentials);
class DiscordChannel {
  constructor (id, name) {
    this.id = id;
    this.name = name;
  }
  send (msg) {
    return new Promise ((resolve, reject) => {
      if (dustforceDiscord.ws.connection !== null && dustforceDiscord.status === 0) {
        let channel = dustforceDiscord.channels.get(this.id);
        if (typeof channel !== 'undefined') {
          resolve(channel.send(msg));
        } else {
          reject('Discord connection open, but ' + this.name + ' channel wasn\'t found.');
        }
      } else {
        reject('Discord connection not open. (Tried to send message to ' + this.name + ' channel)');
      }
    });
  }
}
const dustforceGeneralChannel = new DiscordChannel('276106941875355658', 'general');
const dustforceLeaderboardsChannel = new DiscordChannel('204159286966747136', 'leaderboard-updates');
const gliStreamChannel = new DiscordChannel('406841153909030932', 'gaming-streams');
setTimeout(() => {
  dustforceDiscord.login(token);
}, 5000);
twitch.on('dustforceStream', (stream) => {
  dustforceGeneralChannel.send('<' + stream.url + '> just went live: ' + stream.title).then((message) => {
    //console.log(message);
  }).catch((e) => {
    console.error(e);
  });
});
twitch.on('gliStream', (stream) => {
  let streamMessage = {
    "embed": {
      //"color": 11000000,
      "author": {
        "name": 'Glideus',
        "url": 'https://twitch.tv/glideus',
        "icon_url": 'https://i.imgur.com/5CsG4op.jpg'
      },
      "thumbnail": {
        "url": stream.game_box_art
      },
      "description": 'Title: ' + stream.title + '\nGame: ' + stream.game
    }
  };
  gliStreamChannel.send(streamMessage).then((message) => {
    //
  }).catch((err) => {
    console.error(err);
  });
});
dustforceDiscord.on('ready', () => {
  dustforceDiscord.user.setPresence({
    "status": 'online',
    "game": {
      "name": 'Dustforce'
    }
  });
});
function toWeirdCase (pattern, str) {
  return str.split('').map((v, i) => pattern[i%7+1] === pattern[i%7+1].toLowerCase() ? v.toLowerCase() : v.toUpperCase()).join('');
}
dustforceDiscord.on('message', (message) => {
  let streamCommandRegex = /^(\.|!)streams$/i;
  let streamNotCased = /^(\.|!)streams$/;
  if (message.channel.id === dustforceGeneralChannel.id) {
    if (streamCommandRegex.test(message.content)) {
      let applyWeirdCase = !streamNotCased.test(message.content);
      let streams = twitch.getStreams();
      let nobodyStreaming = 'Nobody is streaming.';
      let unknownStreaming = 'At least 1 person is streaming. I\'ll push notification(s) after I finish gathering data.';
      if (applyWeirdCase) {
        nobodyStreaming = toWeirdCase(message.content, nobodyStreaming);
        unknownStreaming = toWeirdCase(message.content, unknownStreaming);
      }
      if (Object.keys(streams).length === 0) {
        message.channel.send(nobodyStreaming);
      } else {
        let streamsString = '';
        for (let stream of Object.keys(streams)) {
          let streamTitle = streams[stream]["title"];
          if (applyWeirdCase) {
            streamTitle = toWeirdCase(message.content, streamTitle);
          }
          if (typeof streams[stream]["login"] !== 'undefined') {
            streamTitle = streamTitle.replace(/\\(\*|@|<|>|:|_|`|~|\\)/g, '$1').replace(/(\*|@|<|>|:|_|`|~|\\)/g, '\\$1');
            streamsString += '<' + streams[stream]["url"] + '> - ' + streamTitle + '\n';
          }
        }
        if (streamsString === '') {
          message.channel.send(unknownStreaming);
        } else {
          streamsString = streamsString.slice(0, -1);
          message.channel.send(streamsString);
        }
      }
    }
    if (message.content.indexOf('dustkid.com/replay/') !== -1) {
      let replay_id = Number(message.content.split('dustkid.com/replay/')[1].split(' ')[0].replace(/[^0-9\-]/g, ''));
      if (typeof replay_id === 'number' && !isNaN(replay_id)) {
        let responseCounter = 0;
        request({
          "host": 'dustkid.com',
          "path": '/replayviewer.php?' + querystring.stringify({
            "replay_id": replay_id,
            "json": true,
            "metaonly": true
          })
        }).then((response) => {
          if (responseCounter > 0) {
            console.log('Multiple response counter: ' + responseCounter);
            return;
          }
          responseCounter++;
          let replay = JSON.parse(response.data);
          let tags = '';
          if (!Array.isArray(replay.tag)) {
            if (typeof replay.tag.version === 'string') {
              //tags = '\nDustmod version: ' + replay.tag.version;
            }
            if (typeof replay.tag.mode === 'string' && replay.tag.mode !== '') {
              tags = '\nMode: ' + replay.tag.mode;
            }
          }
          const usernameWrapper = '**[' + replay.username + '](http://dustkid.com/profile/' + replay.user + '/)**';
          const camera = '[<:camera:401772771908255755>](http://dustkid.com/replay/' + replay.replay_id + ')';
          let tas = '';
          let ranks = '';
          if (replay.validated === -5) {
            tas = ' - [TAS]'
          } else if (replay.rank_all_time !== false && replay.rank_all_score !== false) {
            let time_ties = '';
            let score_ties = '';
            if (replay.rank_all_score_ties > 0) {
              score_ties = ' (' + (replay.rank_all_score_ties + 1) + '-way tie)';
            }
            if (replay.rank_all_time_ties > 0) {
              time_ties = ' (' + (replay.rank_all_time_ties + 1) + '-way tie)';
            }
            ranks = 'Score Rank: ' + replayTools.rankToStr(replay.rank_all_score + 1) + score_ties + '\n' +
                    'Time Rank: '  + replayTools.rankToStr(replay.rank_all_time + 1)  + time_ties + '\n';
          }
          let replayMessage = {
            "embed": {
              "author": {
                "name": replay.levelname,
                "url": 'http://dustkid.com/level/' + replay.level,
                "icon_url": 'https://cdn.discordapp.com/emojis/' + replayTools.characterIcons(replay.character) + '.png'
              },
              "description": camera + ' ' + usernameWrapper + tas + '\n' +
                'Score: ' + replayTools.scoreToIcon(replay.score_completion) + replayTools.scoreToIcon(replay.score_finesse) + '\n' +
                'Time: ' + replayTools.parseTime(replay.time) + '\n' + ranks +
                '<:apple:230164613424087041> ' + replay.apples + tags,
              "footer": {
                "text": 'Date'
              },
              "timestamp": new Date(Number(replay.timestamp) * 1000)
            }
          };
          let messageSendCounter = 0;
          message.channel.send(replayMessage).then((message) => {
            if (messageSendCounter > 0) {
              console.log('messageSendCounter: ' + messageSendCounter);
              messageSendCounter++;
            }
          }).catch((e) => {
            console.error(e);
          });
        }).catch((e) => {
          console.error(e);
        });
      }
    }
  }
});
dustforceDiscord.on('messageDelete', (message) => {
  //
});
dustforceDiscord.on('messageReactionAdd', (reaction, user) => {
  //
});
replays.on('replay', (replay) => {
  console.log(replay.replay_id);
  replay.character = Number(replay.character);
  if (typeof replayTools["level_thumbnails"][replay.level_name] !== 'undefined') {
    if ((replay.level_name === 'yottadifficult' || replay.level_name === 'exec func ruin user') && (typeof replay["previous_score_pb"] === 'undefined' || Number(replay["previous_score_pb"].score) !== 1285) && Number(replay.score) === 1285) {
      let previous = '';
      if (typeof replay["previous_score_pb"] !== 'undefined') {
        previous = replay["previous_score_pb"];
      }
      createReplayMessage(replay, "Score", previous, true);
    }
    if (replay.score_rank_pb && replay.score_tied_with < 11) {
      let previous = '';
      if (typeof replay["previous_score_pb"] !== 'undefined') {
        previous = replay["previous_score_pb"];
      }
      createReplayMessage(replay, "Score", previous, false);
    }
    if (replay.time_rank_pb && replay.time_tied_with < 11) {
      let previous = '';
      if (typeof replay["previous_time_pb"] !== 'undefined') {
        previous = replay["previous_time_pb"];
      }
      createReplayMessage(replay, "Time", previous, false);
    }
  }
});
function createReplayMessage (replay, type, previous, firstSS) {
  if (Number(replay.user_id) === 0 || Number(replay.user_id) === 1 || Number(replay.user_id) === 19998) return; // [not logged in], Anonymous, guest
  const lowercaseType = type.toLowerCase();
  const colors = [ 8493779, 12147535, 11829461, 9874791 ];
  const characterIcons = [ '401402235004911616', '401402216272887808', '401402223357329418', '401402248040546315' ];
  const camera = '[<:camera:401772771908255755>](http://dustkid.com/replay/' + replay.replay_id + ')';
  const usernameWrapper = '**[' + replay.username + '](http://dustkid.com/profile/' + replay.user_id + '/)**';
  const spaces = '       ';
  let x_way_tie = '';
  if (replay[lowercaseType + "_rank"] !== replay[lowercaseType + "_tied_with"]) {
    x_way_tie = (replay[lowercaseType + "_rank"] - replay[lowercaseType + "_tied_with"] + 1);
    x_way_tie = ' (' + x_way_tie.toString() + '-way tie)';
  }
  let previousTime = '';
  let previousRank = '';
  if (typeof previous === 'object') {
    previousRank = ' _' + replayTools.rankToStr(previous[lowercaseType + "_rank"]) + '_  ->';
    previousTime = ' _' + replayTools.parseTime(previous["time"]) + '_  ->';
  }
  if (x_way_tie === '' && Number(replay[lowercaseType + "_tied_with"]) === 1) {
    request({
      "host": 'df.hitboxteam.com',
      "path": '/backend6/scores.php?' + querystring.stringify({
        "level": replay.level_name,
        "max": 1,
        "offset": 1
      })
    }).then((response) => {
      let second_place = JSON.parse(response.data)["best_" + lowercaseType + "s"][0];
      let previous_second = second_place;
      second_place.finesse = replayTools.letterToScore(second_place.score_finesse);
      second_place.completion = replayTools.letterToScore(second_place.score_thoroughness);
      let second_place_score = second_place.finesse + second_place.completion;
      let previous_score = previous.finesse + previous.completion;
      if (typeof previous === 'object') {
        if (lowercaseType === 'time') {
          if ((Number(previous["time"]) < Number(second_place["time"])) ||
            (Number(previous["time"]) === Number(second_place["time"]) && previous_score < second_place_score) ||
            (Number(previous["time"]) === Number(second_place["time"]) && previous_score === second_place_score && Number(previous["timestamp"]) < Number(second_place["timestamp"]))
          ) {
            previous_second = previous;
          }
        }
        if (lowercaseType === 'score') {
          if (previous_score < second_place_score || 
            (previous_score === second_place_score && Number(previous["time"]) < Number(previous_second["time"])) || 
            (previous_score === second_place_score && Number(previous["time"]) === Number(previous_second["time"]) && Number(previous["timestamp"]) < Number(second_place["timestamp"]))
          ) {
            previous_second = previous;
          }
        }
      }
      let improvedBy = Number(previous_second["time"]) - Number(replay["time"]);
      let message = '';
      let date = new Date(Number(replay.timestamp) * 1000);
      date = date.toDateString();
      if (Number(previous_second["user_id"]) === Number(replay["user_id"])) {
        if (Number(replay["time"]) < Number(previous_second["time"])) {
          message = replay.username + ' improved ' + replay.level_clean_name + ' (' + type + ') by ' + replayTools.parseTime(improvedBy) +
            ' seconds with a time of ' + replayTools.parseTime(replay.time) + ', score ' + replayTools.scoreToLetter(replay.completion) + replayTools.scoreToLetter(replay.finesse) +
            ' as ' + replayTools.characterToString(replay.character) + ' / ' + date + ' #Dustforce';
        } else {
          message = replay.username + ' improved ' + replay.level_clean_name + ' (' + type + ') by getting a higher score with a time of ' + replayTools.parseTime(replay.time) +
            ', score ' + replayTools.scoreToLetter(replay.completion) + replayTools.scoreToLetter(replay.finesse) + ' as ' + replayTools.characterToString(replay.character) + ' / ' + date + ' #Dustforce';
        }
      } else {
        if (Number(replay["time"]) < Number(previous_second["time"])) {
          message = replay.username + ' beat ' + previous_second.name + ' on ' + replay.level_clean_name + ' (' + type + ') by ' + replayTools.parseTime(improvedBy) + ' seconds with a time of ' +
            replayTools.parseTime(replay.time) + ', score ' + replayTools.scoreToLetter(replay.completion) + replayTools.scoreToLetter(replay.finesse) + ' as ' + replayTools.characterToString(replay.character) + ' / ' + date + ' #Dustforce';
        } else {
          message = replay.username + ' beat ' + previous_second.name + ' on ' + replay.level_clean_name + ' (' + type + ') by getting a higher score with a time of ' + replayTools.parseTime(replay.time) + ', score ' + 
            replayTools.scoreToLetter(replay.completion) + replayTools.scoreToLetter(replay.finesse) + ' as ' + replayTools.characterToString(replay.character) + ' / ' + date + ' #Dustforce';
        }
      }
      twitter.post('statuses/update', { "status": message }, (err, data, response) => {
        if (err) {
          console.error(err);
        }
      });
    }).catch((err) => {
      console.error(err);
    });
  }
  if (firstSS) {
    type = 'First SS';
  }
  let replayMessage = {
    "embed": {
      "color": colors[replay.character],
      "author": {
        "name": replay.level_clean_name + ' - ' + type,
        "url": 'http://dustkid.com/level/' + replay.level_name,
        "icon_url": "https://cdn.discordapp.com/emojis/" + characterIcons[replay.character] + ".png"
      },
      "thumbnail": {
        "url": "https://i.imgur.com/" + replayTools["level_thumbnails"][replay.level_name] + ".png"
      },
      "description": camera + ' ' + usernameWrapper + '\n' +
        spaces + replayTools.scoreToIcon(replay.completion) + previousRank + ' _' + replayTools.rankToStr(replay[lowercaseType + "_tied_with"]) + '_' + x_way_tie + '\n' +
        spaces + replayTools.scoreToIcon(replay.finesse) + previousTime + ' _' + replayTools.parseTime(replay.time) + '_',
      "footer": {
        "text": 'Date'
      },
      "timestamp": new Date(Number(replay.timestamp) * 1000)
    }
  };
  dustforceLeaderboardsChannel.send(replayMessage).then((message) => {
    //
  }).catch((err) => {
    console.error(err);
  });
}
dustforceDiscord.on('disconnect', () => {
  setTimeout(() => {
    dustforceDiscord.login(token);
  }, 10000);
});
