module.exports = function (angel) {
  require('./scripts/configure')(angel)
  require('./scripts/use')(angel)
  require('./scripts/list')(angel)
}
