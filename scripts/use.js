var merge = require('merge-util')
var path = require("path")
var fs = require("fs")
var glob = require("glob-stream")
var fse = require('fs-extra')
var async = require('async')
var exec = require('child_process').exec

var temp = require('temp')
// Automatically track and cleanup files at exit
temp.track()

var deepMergeFile = function(templatesRoot, root, startHook, doneHook) {
  return function(file) {
    if(file.path.indexOf('upgrade.json') > -1) return
    if(startHook) startHook(file)
    var sourcePath = file.path
    var destPath = path.join(root, sourcePath.replace(templatesRoot, ""))
    if(path.extname(sourcePath) == ".json") {
      fs.readFile(sourcePath, function(err, sourceData){
        if(err) return console.error("failed to read template: ", sourcePath, err)
        sourceData = JSON.parse(sourceData.toString())
        fs.readFile(destPath, function(err, destData){
          if(destData)
            destData = JSON.parse(destData.toString())
          else
            destData = {}
          if(typeof sourceData != "object")
            destData = sourceData
          else
            merge(destData, sourceData)
          fse.ensureFile(destPath, function(err){
            if(err) return console.error("failed to ensure file", destPath, err)
            fs.writeFile(destPath, JSON.stringify(destData, null, 2), function(err){
              if(err)
                console.error("failed to write: ", destPath, err)
              else
                console.log("wrote: ", destPath.replace(root, ''))
              if(doneHook) doneHook(file)
            })
          })
        })
      })
    } else
    if(sourcePath.indexOf(".gitignore") > -1) {
      fs.readFile(sourcePath, function(err, sourceData){
        if(err) return console.error("failed to read: ", sourcePath)
        fse.ensureFile(destPath, function(err){
          if(err) return console.error("failed to ensure file", destPath, err)
          fs.readFile(destPath, function(err, destData){
            var sourceLines = sourceData.toString().split("\n")
            var destLines = destData.toString().split("\n")
            sourceLines.forEach(function(line){
              if(destLines.indexOf(line) == -1)
                destLines.push(line)
            })
            fs.writeFile(destPath, destLines.join("\n"), function(err){
              if(err)
                console.error("failed to append: ", sourcePath, "->", destPath, err)
              else
                console.log("wrote: ", destPath.replace(root, ''))
              if(doneHook) doneHook(file)
            })
          })
        })
      })
    } else {
      fs.readFile(sourcePath, function(err, data){
        if(err) return console.error("failed to read: ", sourcePath)
        fse.ensureFile(destPath, function(err){
          if(err) return console.error("failed to ensure file", destPath, err)
          fs.writeFile(destPath, data, function(err){
            if(err)
              console.error("failed to copy over: ", sourcePath, "->", destPath, err)
            else
              console.log("wrote: ", destPath.replace(root, ''))
            if(doneHook) doneHook(file)
          })
        })
      })
    }
  }
}

var mergeStack = function (templatesRoot, done) {
  var root = process.cwd()
  var filesToProcess = 0
  var onFileStart = function(){
    filesToProcess += 1
  }
  var onFileDone = function(){
    filesToProcess -= 1
    if(filesToProcess == 0) {
      done && done()
    }
  }

  glob.create(templatesRoot+"/**/*.*", {dot: true, ignore: ["/.git", "/upgrade.json"]})
    .on("data", deepMergeFile(templatesRoot, root, onFileStart, onFileDone))
    .on("error", console.error)
    .on('end', function () {
      if (filesToProcess === 0) {
        console.info('no files to process in', templatesRoot+"/**/*.*")
        done(new Error('upgrade merge failed, no files were found'))
      }
    })
}

var applyStack = function (options) {
  return function (next) {

    var templateRoot = options.root
    var upgradeRoot = templateRoot
    var upgradeMetaInfo = require(templateRoot+"/upgrade.json")

    if (upgradeMetaInfo.main) {
      upgradeRoot = path.join(templateRoot, upgradeMetaInfo.main)
    }

    if (upgradeMetaInfo.dependencies) {
      var hasMissingDependencies = false
      var appliedUpgrades = require(path.join(process.cwd(), "package.json"))["stack-upgrades"]
      for (var key in upgradeMetaInfo.dependencies) {
        if (!appliedUpgrades[key]) {
          console.error('upgrade dependency not found:', key)
          hasMissingDependencies = true
        }
      }
      if (hasMissingDependencies) {
        return next && next(new Error('upgrade dependency not found'))
      }
    }

    var storeUpgrade = function (done) {
      var pjsonpath = path.join(process.cwd(), "package.json")
      fs.readFile(pjsonpath, function (err, content) {
        if (err) return done(err)
        var packagejson = JSON.parse(content)
        packagejson['stack-upgrades'] = packagejson['stack-upgrades'] || {}
        packagejson['stack-upgrades'][upgradeMetaInfo.name] = upgradeMetaInfo.version
        console.info("updating package.json stack-upgrades ...")
        fs.writeFile(pjsonpath, JSON.stringify(packagejson, null, 2), done)
      })
    }

    console.info("apply upgrade", upgradeRoot.replace(process.cwd(), ''), "...")
    mergeStack(upgradeRoot, function (err) {
      if (err) return next(err)
      if (upgradeMetaInfo.peerUpgrades) {
        var appliedUpgrades = require(path.join(process.cwd(), "package.json"))["stack-upgrades"]
        var tasks = []
        for(var key in upgradeMetaInfo.peerUpgrades) {
          if (appliedUpgrades[key]) {
            tasks.push({
              upgradeRoot: path.join(templateRoot, upgradeMetaInfo.peerUpgrades[key])
            })
          }
        }
        async.eachSeries(tasks, function (taskInfo, nextTask) {
          console.info("apply peer upgrade", taskInfo.upgradeRoot.replace(process.cwd(), ''), "...")
          mergeStack(taskInfo.upgradeRoot, nextTask)
        }, function (err) {
          if (err) return next(err)
          storeUpgrade(next)
        })
      } else {
        storeUpgrade(next)
      }
    })
  }
}

module.exports = function (angel) {
  var handleResult = function(err){
    if(err) {
      console.error(err)
      process.exit(1)
      return
    }

    var npmInstall = exec('npm install')
    npmInstall.stdout.pipe(process.stdout)
    npmInstall.stderr.pipe(process.stderr)

    npmInstall.on('exit', function (code) {
      if (code !== 0) return process.exit(code)
      console.info("all done, git diff & go")
    })
  }

  angel.on("stack use :input", function (angel) {
    if (angel.cmdData.input.indexOf('git') > -1)
      return angel.do('stack use ' + angel.cmdData.input + ' ./ master')
    angel.do('stack list.json', function (err, upgrades) {
      if (err) return
      var foundUpgradePath
      for (var i = 0; i < upgrades.length; i++) {
        if (upgrades[i].name === angel.cmdData.input) {
          foundUpgradePath = path.dirname(upgrades[i].fullPath)
        }
      }
      var options = {
        root: (foundUpgradePath || path.join(process.cwd(), angel.cmdData.input))
      }
      applyStack(options)(handleResult)
    })
  })
  angel.on("stack use :source :updatePath", function (angel) {
    angel.do('stack use ' + angel.cmdData.source + ' ' + angel.cmdData.updatePath + ' master')
  })
  angel.on("stack use :source :updatePath :branch", function(angel){
    require("angelabilities-exec")(angel)
    var options = {
      root: ''
    }
    var tasks = [
      // clone to a temporary folder
      function(next){
        console.info("cloning upstream source ...")
        temp.mkdir('upstream', function(err, dirPath) {
          if(err) return next(err)
          options.root = path.join(dirPath, angel.cmdData.updatePath)
          angel.sh([
            "git clone "+ angel.cmdData.source + " " + dirPath,
            "cd " + dirPath,
            "git checkout " + angel.cmdData.branch
          ].join(" && "), next)
        })
      },
      // apply upgrade
      applyStack(options)
    ]

   async.eachSeries(tasks, function(task, next){
     task(next)
   }, handleResult)
  })
  .example("$ angel stack use ...")
  .description("manage project's stack")
}
