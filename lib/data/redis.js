var conf = require('../../config.js').database,
  Database = require('./base.js').Database,
  redis = require("redis"),
  redisClient = null, //redis.createClient(),
  async = require("async"),
  sets = require('simplesets');

// If you want Memory Store instead...
// var MemoryStore = require('connect/middleware/session/memory');
// var session_store = new MemoryStore();

var REDIS_PREFIX = '#scrumblr#';

//For Redis Debugging

function RedisDatabase() {
  Database.call(this);
}

RedisDatabase.prototype = {
  constructor: RedisDatabase,
  init: function (callback) {
    console.log('Opening redis connection to ' + conf.redis);
    redisClient = redis.createClient(conf.redis);

    redisClient.on("connect", function (err) {
      Database.prototype.init.apply(this, [callback]);
    });

    redisClient.on("error", function (err) {
      console.log("Redis error: " + err);
    });
  },

  clearRoom: function (room, callback) {
    redisClient.del(REDIS_PREFIX + '-room:/demo-cards', function (err, res) {
      redisClient.del(REDIS_PREFIX + '-room:/demo-columns', function (err, res) {
        callback();
      });
    });
  },

  // theme commands
  setTheme: function (room, theme) {
    redisClient.set(REDIS_PREFIX + '-room:' + room + '-theme', theme);
  },

  getTheme: function (room, callback) {
    redisClient.get(REDIS_PREFIX + '-room:' + room + '-theme', function (err, res) {
      callback(res);
    });
  },

  // revision commands
  setRevisions: function (room, revisions) {
    if (Object.keys(revisions).length === 0) {
      redisClient.del(REDIS_PREFIX + '-room:' + room + '-revisions');
    } else {
      redisClient.set(REDIS_PREFIX + '-room:' + room + '-revisions', JSON.stringify(revisions));
    }
  },

  getRevisions: function (room, callback) {
    redisClient.get(REDIS_PREFIX + '-room:' + room + '-revisions', function (err, res) {
      callback(JSON.parse(res));
    });
  },

  // Column commands
  createColumn: function (room, name, callback) {
    console.log('Creating new column ' + name)
    redisClient.rpush(REDIS_PREFIX + '-room:' + room + '-columns', JSON.stringify({title: name}),
      function (err, res) {
        if (typeof callback != "undefined" && callback !== null) callback();
      }
    );
  },

  getAllColumns: function (room, callback) {
    redisClient.lrange(REDIS_PREFIX + '-room:' + room + '-columns', 0, -1, function (err, columns) {
      for (var id in columns) {
        columns[id] = JSON.parse(columns[id])
      }
      callback(columns);
    });
  },

  deleteColumn: function (room) {
    redisClient.rpop(REDIS_PREFIX + '-room:' + room + '-columns');
  },

  setColumns: function (room, columns) {
    // FIXME smoreau: not very comfortable with the current Redis data model, hard to refactor ?

    //1. first delete all columns
    console.log('Setting columns ' + JSON.stringify(columns))
    redisClient.del(REDIS_PREFIX + '-room:' + room + '-columns', function () {
      //2. now add columns for each thingy
      async.forEachSeries(
        columns,
        function (item, callback) {
          console.log('rpush: ' + REDIS_PREFIX + '-room:' + room + '-columns' + ' -- ' + JSON.stringify(item));
          redisClient.rpush(REDIS_PREFIX + '-room:' + room + '-columns', JSON.stringify(item),
            function (err, res) {
              callback();
            }
          );
        },
        function () {
          //this happens when the series is complete
        }
      );
    });
  },

  // Card commands
  createCard: function (room, id, card) {
    var cardString = JSON.stringify(card);
    redisClient.hset(
      REDIS_PREFIX + '-room:' + room + '-cards',
      id,
      cardString
    );
  },

  getAllCards: function (room, callback) {
    redisClient.hgetall(REDIS_PREFIX + '-room:' + room + '-cards', function (err, res) {

      var cards = [];

      for (var i in res) {
        cards.push(JSON.parse(res[i]));
      }
      //console.dir(cards);

      callback(cards);
    });
  },

  cardEdit: function (room, id, text, description) {
    redisClient.hget(REDIS_PREFIX + '-room:' + room + '-cards', id, function (err, res) {
      var card = JSON.parse(res);
      if (card !== null) {
        card.text = text;
        card.desc = description;
        var cardJSON = JSON.stringify(card);
        console.log('Saving card ' + cardJSON);
        redisClient.hset(REDIS_PREFIX + '-room:' + room + '-cards', id, cardJSON);
      }
    });
  },

  cardSetXY: function (room, id, x, y) {
    redisClient.hget(REDIS_PREFIX + '-room:' + room + '-cards', id, function (err, res) {
      var card = JSON.parse(res);
      if (card !== null) {
        card.x = x;
        card.y = y;
        redisClient.hset(REDIS_PREFIX + '-room:' + room + '-cards', id, JSON.stringify(card));
      }
    });
  },

  deleteCard: function (room, id) {
    redisClient.hdel(
      REDIS_PREFIX + '-room:' + room + '-cards',
      id
    );
  },

  addSticker: function (room, cardId, stickerId) {
    redisClient.hget(REDIS_PREFIX + '-room:' + room + '-cards', cardId, function (err, res) {
      var card = JSON.parse(res);

      if (null === card || "nosticker" === stickerId)
        card.sticker = [];

      if ("nosticker" !== stickerId && -1 == card.sticker.indexOf(stickerId)) {
        card.sticker.push(stickerId)
      }

      redisClient.hset(REDIS_PREFIX + '-room:' + room + '-cards', cardId, JSON.stringify(card));
    });
  },

  setBoardSize: function (room, size) {
    redisClient.set(REDIS_PREFIX + '-room:' + room + '-size', JSON.stringify(size));
  },

  getBoardSize: function (room, callback) {
    redisClient.get(REDIS_PREFIX + '-room:' + room + '-size', function (err, res) {
      callback(JSON.parse(res));
    });
  },

  setColumnSize: function (room, columnID, width) {
    columnID--;

    // FIXME smoreau: avoid using json encode ?
    redisClient.lrange(REDIS_PREFIX + '-room:' + room + '-columns', columnID, columnID, function (err, column) {
      column = JSON.parse(column);
      column.width = width;
      column = JSON.stringify(column);
      console.log("Updating column[" + columnID + "] with value " + column);

      redisClient.lset(REDIS_PREFIX + '-room:' + room + '-columns', columnID, column);
    });
  }

  // FIXME smoreau: add getColumnsSize

};
exports.db = new RedisDatabase();
