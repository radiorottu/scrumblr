// vim:set noexpandtab:

// FIXME smoreau: replace var with const if possible

/**************
 SYSTEM INCLUDES
 **************/
var http = require('http');
var url = require('url');
var sys = require('sys');
var async = require('async');
var sanitizer = require('sanitizer');
var compression = require('compression');
var express = require('express');
var conf = require('./config.js').server;
var ga = require('./config.js').googleanalytics;
var parse = require('parseurl');
const querystring = require('querystring');
const util = require('util');



/**************
 LOCAL INCLUDES
 **************/
var rooms = require('./lib/rooms.js');

/**************
 GLOBALS
 **************/
//Map of sids to user_names
var sids_to_user_names = [];

/**************
 SETUP EXPRESS
 **************/
var app = express();
var router = express.Router();

app.use(compression());
app.use(conf.baseurl, router);

app.locals.ga = ga.enabled;
app.locals.gaAccount = ga.account;

router.use(express.static(__dirname + '/client'));

var server = require('http').Server(app);
server.listen(conf.port, () => console.log('Server running at http://127.0.0.1:' + conf.port + '/'));

/**************
 SETUP Socket.IO
 **************/
var io = require('socket.io')(server, {
  path: conf.baseurl == '/' ? '' : conf.baseurl + "/socket.io"
});


/**************
 ROUTES
 **************/
router.get('/', function (req, res) {
  //console.log(req.header('host'));
  url = req.header('host') + req.baseUrl;

  var connected = io.sockets.connected;
  clientsCount = Object.keys(connected).length;

  res.render('home.jade', {
    url: url,
    connected: clientsCount
  });
});


router.get('/demo', function (req, res) {
  res.render('index.jade', {
    pageTitle: 'scrumblr - demo',
    demo: true
  });
});

router.get('/:roomID', function (req, res) {
  // FIXME smoreau: how to get URL parameters back to io.sockets.on('connection') core
  // bad design ?

  //console.log("Getting route for " + util.inspect(req));
  console.log("Getting route for room " + req.params.roomID + ' (client ' + req.client.id + ')');

  res.render('index.jade', {
    pageTitle: ('scrumblr - ' + req.params.roomID)
  });
});


/**************
 SOCKET.I0
 **************/
//sanitizes text
function scrub(text) {
  if (typeof text != "undefined" && text !== null) {

    //clip the string if it is too long
    if (text.length > 65535) {
      text = text.substr(0, 65535);
    }

    return sanitizer.sanitize(text);
  }
  else {
    return null;
  }
}

io.sockets.on('connection', function (client) {
  //console.log("New client connected " + util.inspect(client) + client.id);
  //console.log("New client connected " + util.inspect(client));

  client.on('message', function (message) {
    console.log(message.action + " -- " + sys.inspect(message.data));

    var clean_data = {};
    var clean_message = {};
    var message_out = {};

    if (!message.action) return;

    switch (message.action) {
      case 'joinRoom':
        var url = parse({ url: message.data });
        var room = url.pathname;
        var parameters = querystring.parse(url.query);

        console.log("Joining room " + room + ' with parameters ' + util.inspect(parameters));
        joinRoom(client, room, function (clients) {
          initClient(client, parameters);
        });

        break;

      case 'moveCard':
        //report to all other browsers
        message_out = {
          action: message.action,
          data: {
            id: scrub(message.data.id),
            position: {
              left: scrub(message.data.position.left),
              top: scrub(message.data.position.top)
            }
          }
        };


        broadcastToRoom(client, message_out);

        // console.log("-----" + message.data.id);
        // console.log(JSON.stringify(message.data));

        getRoom(client, function (room) {
          db.cardSetXY(room, message.data.id, message.data.position.left, message.data.position.top);
        });

        break;

      case 'createCard':
        data = message.data;
        clean_data = {};
        clean_data.text = scrub(data.text);
        clean_data.desc = scrub(data.desc);
        clean_data.x = scrub(data.x);
        clean_data.y = scrub(data.y);
        clean_data.rot = scrub(data.rot);
        clean_data.colour = scrub(data.colour);

        getRoom(client, function (room) {
          createCard(room, clean_data.text, clean_data.x, clean_data.y, clean_data.rot, clean_data.colour, clean_data.desc, function (newCard) {
            message_out = {
              action: 'createCard',
              data: newCard
            };

            //report to all other browsers
            rooms.broadcast_room(room, message_out);

            // FIXME smoreau: previously using this function, but now we need to broadcast the
            // FIXME          new card to all clients of the room (including the creator
            // FIXME          because it doesn't know the newly card unique id)
            //broadcastToRoom( client, message_out );
          });
        });

        break;

      case 'editCard':

        clean_data = {};
        clean_data.desc = scrub(message.data.desc);
        clean_data.value = scrub(message.data.value);
        clean_data.id = scrub(message.data.id);

        //send update to database
        getRoom(client, function (room) {
          db.cardEdit(room, clean_data.id, clean_data.value, clean_data.desc);
        });

        message_out = {
          action: 'editCard',
          data: clean_data
        };

        broadcastToRoom(client, message_out);

        break;


      case 'deleteCard':
        clean_message = {
          action: 'deleteCard',
          data: {id: scrub(message.data.id)}
        };

        getRoom(client, function (room) {
          db.deleteCard(room, clean_message.data.id);
        });

        //report to all other browsers
        broadcastToRoom(client, clean_message);

        break;

      case 'createColumn':
        clean_message = {data: scrub(message.data)};

        getRoom(client, function (room) {
          db.createColumn(room, clean_message.data, function () {
          });
        });

        broadcastToRoom(client, clean_message);

        break;

      case 'deleteColumn':
        getRoom(client, function (room) {
          db.deleteColumn(room);
        });
        broadcastToRoom(client, {action: 'deleteColumn'});

        break;

      case 'updateColumns':
        var columns = message.data;
        console.log("updateColumns() " + JSON.stringify(columns));

        if (!(columns instanceof Array))
          break;

        // FIXME smoreau: removed scrub() call, is it safe ?

        getRoom(client, function (room) {
          db.setColumns(room, columns);
        });

        broadcastToRoom(client, {action: 'updateColumns', data: columns});

        break;

      case 'changeTheme':
        clean_message = {};
        clean_message.data = scrub(message.data);

        getRoom(client, function (room) {
          db.setTheme(room, clean_message.data);
        });

        clean_message.action = 'changeTheme';

        broadcastToRoom(client, clean_message);
        break;

      case 'setUserName':
        clean_message = {};

        clean_message.data = scrub(message.data);

        setUserName(client, clean_message.data);

        var msg = {};
        msg.action = 'nameChangeAnnounce';
        msg.data = {sid: client.id, user_name: clean_message.data};
        broadcastToRoom(client, msg);
        break;

      case 'addSticker':
        var cardId = scrub(message.data.cardId);
        var stickerId = scrub(message.data.stickerId);

        getRoom(client, function (room) {
          db.addSticker(room, cardId, stickerId);
        });

        broadcastToRoom(client, {action: 'addSticker', data: message.data});
        break;

      case 'setBoardSize':

        var size = {};
        size.width = scrub(message.data.width);
        size.height = scrub(message.data.height);

        getRoom(client, function (room) {
          db.setBoardSize(room, size);
        });

        broadcastToRoom(client, {action: 'setBoardSize', data: size});
        break;

      case 'setColumnSize':
        var width = scrub(message.data.width);
        var columnID = scrub(message.data.columnID);

        getRoom(client, function (room) {
          db.setColumnSize(room, columnID, width);
        });

        broadcastToRoom(client, {action: 'setColumnSize', data: message.data});
        break;

      case 'exportTxt':
        exportBoard('txt', client, message.data);
        break;

      case 'exportCsv':
        exportBoard('csv', client, message.data);
        break;

      case 'exportJson':
        exportJson(client, message.data);
        break;

      case 'importJson':
        importJson(client, message.data);
        break;

      case 'createRevision':
        createRevision(client, message.data);
        break;

      case 'deleteRevision':
        deleteRevision(client, message.data);
        break;

      case 'exportRevision':
        exportRevision(client, message.data);
        break;

      default:
        //console.log('unknown action');
        break;
    }
  });

  client.on('disconnect', function () {
    leaveRoom(client);
  });

  //tell all others that someone has connected
  //client.broadcast('someone has connected');
});


/**************
 FUNCTIONS
 **************/
function initClient(client, optionalParameters) {
  //console.log ('initClient Started');
  getRoom(client, function (room) {

    db.getAllCards(room, function (cards) {
      var params = {
        action: 'initCards',
        data: cards,
      }
      if (optionalParameters && "highlight" in optionalParameters) {
        params['highlight'] = optionalParameters.highlight;
      }

      client.json.send(params);
    });

    db.getAllColumns(room, function (columns) {
      client.json.send(
        {
          action: 'initColumns',
          data: columns
        }
      );
    });


    db.getRevisions(room, function (revisions) {
      client.json.send({
        action: 'initRevisions',
        data: (revisions !== null) ? Object.keys(revisions) : []
      });
    });

    db.getTheme(room, function (theme) {

      if (theme === null) theme = 'bigcards';

      client.json.send(
        {
          action: 'changeTheme',
          data: theme
        }
      );
    });

    db.getBoardSize(room, function (size) {

      if (size !== null) {
        client.json.send(
          {
            action: 'setBoardSize',
            data: size
          }
        );
      }
    });

    roommates_clients = rooms.room_clients(room);
    roommates = [];

    var j = 0;
    for (var i in roommates_clients) {
      if (roommates_clients[i].id != client.id) {
        roommates[j] = {
          sid: roommates_clients[i].id,
          user_name: sids_to_user_names[roommates_clients[i].id]
        };
        j++;
      }
    }

    //console.log('initialusers: ' + roommates);
    client.json.send(
      {
        action: 'initialUsers',
        data: roommates
      }
    );

  });
}


function joinRoom(client, room, successFunction) {
  var msg = {};
  msg.action = 'join-announce';
  msg.data = {sid: client.id, user_name: client.user_name};

  rooms.add_to_room_and_announce(client, room, msg);
  successFunction();
}

function leaveRoom(client) {
  //console.log (client.id + ' just left');
  var msg = {};
  msg.action = 'leave-announce';
  msg.data = {sid: client.id};
  rooms.remove_from_all_rooms_and_announce(client, msg);

  delete sids_to_user_names[client.id];
}

function broadcastToRoom(client, message) {
  rooms.broadcast_to_roommates(client, message);
}

//----------------CARD FUNCTIONS
function createCard(room, text, x, y, rot, colour, desc, callback) {
  var card = {
    colour: colour,
    rot: rot,
    x: x,
    y: y,
    text: text,
    desc: desc,
    sticker: null
  };

  db.createCard(room, card, callback);
}

function roundRand(max) {
  return Math.floor(Math.random() * max);
}


//------------ROOM STUFF
// Get Room name for the given Session ID
function getRoom(client, callback) {
  room = rooms.get_room(client);
  //console.log( 'client: ' + client.id + " is in " + room);
  callback(room);
}


function setUserName(client, name) {
  client.user_name = name;
  sids_to_user_names[client.id] = name;
  //console.log('sids to user names: ');
  console.dir(sids_to_user_names);
}

function cleanAndInitializeDemoRoom() {
  // DUMMY DATA
  db.clearRoom('/demo', function () {
    db.createColumn('/demo', 'Not Started');
    db.createColumn('/demo', 'Started');
    db.createColumn('/demo', 'Testing');
    db.createColumn('/demo', 'Review');
    db.createColumn('/demo', 'Complete');

    createCard('/demo', 'Hello this is fun', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'yellow');
    createCard('/demo', 'Hello this is a new story.', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'white');
    createCard('/demo', '.', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'blue');
    createCard('/demo', '.', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'green');

    createCard('/demo', 'Hello this is fun', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'yellow');
    createCard('/demo', 'Hello this is a new card.', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'yellow');
    createCard('/demo', '.', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'blue');
    createCard('/demo', '.', roundRand(600), roundRand(300), Math.random() * 10 - 5, 'green');
  });
}

// Export board in txt or csv
function exportBoard(format, client, data) {
  var result = "", i, j, card;
  getRoom(client, function (room) {
    db.getAllCards(room, function (cards) {
      db.getAllColumns(room, function (columns) {
        var cols = {};
        if (columns.length > 0) {
          var column;
          for (i in columns) {
            column = columns[i];
            cols[column.title] = [];
          }

          for (j in cards) {
            card = cards[j];
            var currentWidth = 0;
            for (i = 0; i < columns.length; i++) {
              column = columns[i];
              if (i === columns.length - 1 || currentWidth <= card.x && card.x < currentWidth + column.width)
                break;
              currentWidth += column.width;
            }
            cols[column.title].push(card);
            cols[column.title].sort(function (a, b) {
              if (a['y'] === b['y']) {
                return (a['x'] - b['x']);
              } else {
                return a['y'] - b['y'];
              }
            });
          }
          switch (format) {
            case "txt":
              for (i = 0; i < columns.length; i++) {
                var columnTitle = columns[i].title;
                result += "# " + columnTitle + '\n';

                for (var j = 0; j < cols[columnTitle].length; j++) {
                  result += '- ' + cols[columnTitle][j].text + '\n';
                }
                result += '\n';
              }
              break;

            case "csv":
              var numberOfRows = 0;
              var line = [];
              for (i = 0; i < columns.length; i++) {
                var columnTitle = columns[i].title;
                line.push('"' + columnTitle.replace(/"/g, '""') + '"');

                for (j = 0; j < cols[columnTitle].length; j++) {
                  numberOfRows = Math.max(cols[columnTitle].length, numberOfRows);
                }
              }
              result += line.join(',') + '\n';
              for (j = 0; j < numberOfRows; j++) {
                line = [];
                for (i = 0; i < columns.length; i++) {
                  var columnTitle = columns[i].title;
                  var val = (cols[columnTitle][j] !== undefined) ? cols[columnTitle][j].text.replace(/"/g, '""') : '';
                  line.push('"' + val + '"');
                }
                result += line.join(',') + '\n';
              }
              break;
          }
        } else {
          for (j = 0; j < cards.length; j++) {
            card = cards[j];
            if (format === 'txt') {
              result += '- ' + card.text + '\n';
            } else if (format === 'csv') {
              result += '"' + card.text.replace(/"/g, '""') + '"\n';
            }
          }
        }

        console.log("Exporting data to " + format + ": " + result);

        client.json.send({
          action: 'export',
          data: {
            filename: room.replace('/', '') + '.' + format,
            text: result
          }
        });
      });
    });
  });
}

// Export board in json, suitable for import
function exportJson(client, data) {
  var result = [];
  getRoom(client, function (room) {
    db.getAllCards(room, function (cards) {
      db.getAllColumns(room, function (columns) {
        db.getTheme(room, function (theme) {
          db.getBoardSize(room, function (size) {
            if (theme === null) theme = 'bigcards';
            if (size === null) size = {width: data.width, height: data.height};
            result = JSON.stringify({
              cards: cards,
              columns: columns,
              theme: theme,
              size: size
            });
            client.json.send(
              {
                action: 'export',
                data: {
                  filename: room.replace('/', '') + '.json',
                  text: result
                }
              }
            );
          });
        });
      });
    });
  });
}

// Import board from json
function importJson(client, data) {
  getRoom(client, function (room) {
    db.clearRoom(room, function () {
      db.getAllCards(room, function (cards) {
        for (var i = 0; i < cards.length; i++) {
          db.deleteCard(room, cards[i].id);
        }

        cards = data.cards;
        var cards2 = [];
        var promises = [];
        for (var i = 0; i < cards.length; i++) {
          var card = cards[i];
          if (card.id !== undefined && card.colour !== undefined
            && card.rot !== undefined && card.x !== undefined
            && card.y !== undefined && card.text !== undefined
            && card.sticker !== undefined) {
            var c = {
              id: card.id,
              colour: card.colour,
              rot: card.rot,
              x: card.x,
              y: card.y,
              text: scrub(card.text),
              desc: scrub(card.desc),
              sticker: card.sticker
            };
            var promise = new Promise(function (resolve, reject) {
              db.createCard(room, c, function (cardWithLocalId) {
                console.log("Added new card " + cardWithLocalId.id);
                cards2.push(cardWithLocalId);
                resolve();
              });
            });

            promises.push(promise);
          }
        }

        Promise.all(promises).then(function() {
          console.log("Broadcasting cards " + cards2.length);
          var msg = {action: 'initCards', data: cards2};
          broadcastToRoom(client, msg);
          client.json.send(msg);
        });
      });

      db.getAllColumns(room, function (columns) {
        for (var i = 0; i < columns.length; i++) {
          db.deleteColumn(room);
        }

        columns = data.columns;
        // FIXME smoreau: no need to sanitize data, right ?
        db.setColumns(room, columns);

        msg = {action: 'initColumns', data: columns};
        broadcastToRoom(client, msg);
        client.json.send(msg);
      });

      var size = data.size;
      if (size.width !== undefined && size.height !== undefined) {
        size = {width: scrub(size.width), height: scrub(size.height)};
        db.setBoardSize(room, size);
        msg = {action: 'setBoardSize', data: size};
        broadcastToRoom(client, msg);
        client.json.send(msg);
      }

      data.theme = scrub(data.theme);
      if (data.theme === 'smallcards' || data.theme === 'bigcards') {
        db.setTheme(room, data.theme);
        msg = {action: 'changeTheme', data: data.theme};
        broadcastToRoom(client, msg);
        client.json.send(msg);
      }
    });
  });
}

//

function createRevision(client, data) {
  var result = [];
  getRoom(client, function (room) {
    db.getAllCards(room, function (cards) {
      db.getAllColumns(room, function (columns) {
        db.getTheme(room, function (theme) {
          db.getBoardSize(room, function (size) {
            if (theme === null) theme = 'bigcards';
            if (size === null) size = {width: data.width, height: data.height};
            result = {
              cards: cards,
              columns: columns,
              theme: theme,
              size: size
            };
            var timestamp = Date.now();
            db.getRevisions(room, function (revisions) {
              if (revisions === null) revisions = {};
              revisions[timestamp + ''] = result;
              db.setRevisions(room, revisions);
              msg = {action: 'addRevision', data: timestamp};
              broadcastToRoom(client, msg);
              client.json.send(msg);
            });
          });
        });
      });
    });
  });
}

function deleteRevision(client, timestamp) {
  getRoom(client, function (room) {
    db.getRevisions(room, function (revisions) {
      if (revisions !== null && revisions[timestamp + ''] !== undefined) {
        delete revisions[timestamp + ''];
        db.setRevisions(room, revisions);
      }
      msg = {action: 'deleteRevision', data: timestamp};
      broadcastToRoom(client, msg);
      client.json.send(msg);
    });
  });
}

function exportRevision(client, timestamp) {
  getRoom(client, function (room) {
    db.getRevisions(room, function (revisions) {
      if (revisions !== null && revisions[timestamp + ''] !== undefined) {
        client.json.send(
          {
            action: 'export',
            data: {
              filename: room.replace('/', '') + '-' + timestamp + '.json',
              text: JSON.stringify(revisions[timestamp + ''])
            }
          }
        );
      } else {
        client.json.send(
          {
            action: 'message',
            data: 'Unable to find revision ' + timestamp + '.'
          }
        );
      }
    });
  });
}

/**************
 SETUP DATABASE ON FIRST RUN
 **************/
// (runs only once on startup)
var conf = require('./config.js').database;

/** @type RedisDatabase|MongoDBDatabase db */
var db = require('./lib/data/' + conf.type + '.js').db;
db.init(cleanAndInitializeDemoRoom);
