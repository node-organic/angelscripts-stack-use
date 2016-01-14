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
                console.log("wrote: ", destPath)
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
                console.log("wrote: ", destPath)
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
              console.log("wrote: ", destPath)
            if(doneHook) doneHook(file)
          })
        })
      })
    }
  }
}


var applyStack = function (options) {
  return function (next) {
    console.info("apply upstream upgrade ...")
    var templatesRoot = options.root
    var root = process.cwd()
    var filesToProcess = 0
    var onFileStart = function(){
      filesToProcess += 1
    }
    var onFileDone = function(){
      filesToProcess -= 1
      if(filesToProcess == 0) {
        next && next()
      }
    }
    glob.create(templatesRoot+"/**/*.*", {dot: true, ignore: "/.git"})
      .on("data", deepMergeFile(templatesRoot, root, onFileStart, onFileDone))
      .on("error", console.error)
      .on('end', function () {
        if (filesToProcess === 0) console.info('no files to process in', templatesRoot+"/**/*.*")
        var npminstall = exec('npm install')
        npminstall.stdout.pipe(process.stdout)
        npminstall.stderr.pipe(process.stderr)
        npminstall.on('exit', process.exit)
      })
  }
}

module.exports = function(angel){
  angel.on("stack use :input", function (angel) {
    if (angel.cmdData.input.indexOf('git') > -1)
      return angel.do('stack use ' + angel.cmdData.input + ' ./ master')
    var options = {
      root: path.join(process.cwd(), angel.cmdData.input)
    }
    applyStack(options)()
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
   }, function(err){
     if(err) {
       console.error(err)
       process.exit(1)
       return
     }
     console.info("all done, git diff & go")
   })
  })
  .example("$ angel stack use ...")
  .description("manage project's stack")
}
