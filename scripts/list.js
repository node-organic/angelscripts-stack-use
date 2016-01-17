var glob = require("glob-stream")
var path = require("path")

module.exports = function (angel) {
  var findUpgrades = function (done) {
    var upgrades = []
    glob.create(process.cwd()+"/**/*/upgrade.json", {dot: true, ignore: ["/.git"], follow: true})
      .on("data", function (file) {
        var upgrade = require(file.path)
        upgrade.fullPath = file.path
        upgrades.push(upgrade)
      })
      .on("error", function (err) {
        console.error(err)
        done(err)
      })
      .on('end', function () {
        done(null, upgrades)
      })
  }
  angel.on('stack list', function (angel) {
    findUpgrades (function (err, upgrades) {
      if (err) return
      upgrades.forEach(function (u) {
        console.log("+ " + u.name + "@" + u.version)
        if (u.dependencies) {
          for(key in u.dependencies) {
            console.log('|- ' + key + "@" + u.dependencies[key])
          }
        }
        console.log("")
      })
    })
  })
  angel.on('stack list.json', function (angel, done) {
    findUpgrades(done)
  })
}
