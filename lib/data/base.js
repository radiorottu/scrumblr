function Database() { }
Database.prototype = {
  addSticker: function (room, cardId, stickerId) {},
  cardEdit: function(room, id, text, description) {},
  cardSetXY: function(room, id, x, y) {},
  clearRoom: function(room, callback) {},
  createCard: function(room, id, card) {},
  createColumn: function (room, name, callback) {},
  deleteCard: function(room, id) {},
  deleteColumn: function(room) {},
  getAllCards: function(room, callback) {},
  getAllColumns: function(room, callback) {},
  getBoardSize: function(room, callback) {},
  getRevisions: function(room, callback) {},
  getTheme: function(room, callback) {},
  init: function(callback) {
    console.log("Calling init function");
    callback();
  },
  setBoardSize: function(room, size) {},
  setColumnSize: function(room, columnID, width) {},
  setColumns: function(room, columns) {},
  setRevisions: function(room, revisions) {},
  setTheme: function(room, theme) {}
};

exports.Database = Database;