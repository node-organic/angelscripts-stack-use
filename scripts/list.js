var glob = require("glob-stream")
var path = require("path")

module.exports = function (angel) {
  angel.on('stack list', function () {
    var upgrades = []
    glob.create(process.cwd()+"/**/upgrade.json", {dot: true, ignore: ["/.git", "/node_modules"]})
      .on("data", function (file) {
        var upgrade = require(file.path)
        upgrade.fullPath = file.path
        upgrades.push(upgrade)
      })
      .on("error", console.error)
      .on('end', function () {
        upgrades.forEach(function (u) {
          console.log("+ " + path.relative(process.cwd(), u.fullPath).replace('upgrade.json', '') + ' | ' + u.name + "@" + u.version)
          if (u.dependencies) {
            for(key in u.dependencies) {
              console.log('|- ' + key + "@" + u.dependencies[key])
            }
          }
          console.log("")
        })
      })
  })
}
