var merge = require('merge-util')
var path = require('path')
var fs = require('fs')
var glob = require('glob-stream')
var fse = require('fs-extra')
var async = require('async')
var exec = require('child_process').exec

var temp = require('temp')
// Automatically track and cleanup files at exit
temp.track()

var deepMergeFile = function (templatesRoot, file, root, doneHook) {
  if (file.path.indexOf('upgrade.json') > -1) return doneHook()
  var sourcePath = file.path
  var destPath = path.join(root, sourcePath.replace(templatesRoot, ''))
  if (path.extname(sourcePath) === '.json') {
    fs.readFile(sourcePath, function (err, sourceData) {
      if (err) {
        console.error('failed to read source', sourcePath, err)
        return doneHook(err)
      }
      sourceData = JSON.parse(sourceData.toString())
      fs.readFile(destPath, function (err, destData) {
        if (err) {
          // we do not care about missing destination, it will be created
        }
        if (destData) {
          destData = JSON.parse(destData.toString())
        } else {
          destData = {}
        }
        if (typeof sourceData !== 'object') {
          destData = sourceData
        } else {
          merge(destData, sourceData)
        }
        fse.ensureFile(destPath, function (err) {
          if (err) {
            console.error('failed to ensure file', destPath, err)
            return doneHook(err)
          }
          fs.writeFile(destPath, JSON.stringify(destData, null, 2), function (err) {
            if (err) {
              console.error('failed to write: ', destPath, err)
            } else {
              console.log('wrote: ', destPath.replace(root, ''))
            }
            doneHook(err)
          })
        })
      })
    })
  } else
  if (sourcePath.indexOf('.gitignore') > -1) {
    fs.readFile(sourcePath, function (err, sourceData) {
      if (err) {
        console.error('failed to read source', sourcePath, err)
        return doneHook(err)
      }
      fse.ensureFile(destPath, function (err) {
        if (err) {
          console.error('failed to ensure file', destPath, err)
          return doneHook(err)
        }
        fs.readFile(destPath, function (err, destData) {
          if (err) {
            // we do not care about missing destination, it will be created
          }
          var sourceLines = sourceData.toString().split('\n')
          var destLines = destData.toString().split('\n')
          sourceLines.forEach(function (line) {
            if (destLines.indexOf(line) === -1) {
              destLines.push(line)
            }
          })
          fs.writeFile(destPath, destLines.join('\n'), function (err) {
            if (err) {
              console.error('failed to append: ', sourcePath, '->', destPath, err)
            } else {
              console.log('wrote: ', destPath.replace(root, ''))
            }
            doneHook()
          })
        })
      })
    })
  } else {
    fs.readFile(sourcePath, function (err, data) {
      if (err) {
        console.error('failed to read: ', sourcePath)
        return doneHook(err)
      }
      fse.ensureFile(destPath, function (err) {
        if (err) {
          console.error('failed to ensure file', destPath, err)
          return doneHook(err)
        }
        fs.writeFile(destPath, data, function (err) {
          if (err) {
            console.error('failed to copy over: ', sourcePath, '->', destPath, err)
          } else {
            console.log('wrote: ', destPath.replace(root, ''))
          }
          doneHook(file)
        })
      })
    })
  }
}

var mergeStack = function (templatesRoot, done) {
  var root = process.cwd()
  var filesToProcess = 0
  var onFileDone = function () {
    filesToProcess -= 1
    if (filesToProcess === 0) {
      done && done()
    }
  }

  glob.create(templatesRoot + '/**/*', {dot: true, ignore: ['/.git', '/upgrade.json']})
    .on('data', function (file) {
      filesToProcess += 1
      fs.stat(file.path, function (err, stats) {
        if (err) {
          filesToProcess -= 1
          return console.error('ERROR: failed to stat', file.path, err)
        }
        if (stats.isDirectory()) {
          filesToProcess -= 1
          return
        }
        deepMergeFile(templatesRoot, file, root, onFileDone)
      })
    })
    .on('error', console.error)
    .on('end', function () {
      if (filesToProcess === 0) {
        console.info('no files to process in', templatesRoot + '/**/*')
        done(new Error('upgrade merge failed, no files were found'))
      }
    })
}

var applyStack = function (options, next) {
  var templateRoot = options.root
  var upgradeRoot = templateRoot
  var upgradeMetaInfo = require(templateRoot + '/upgrade.json')

  if (upgradeMetaInfo.main) {
    upgradeRoot = path.join(templateRoot, upgradeMetaInfo.main)
  }

  if (upgradeMetaInfo.dependencies) {
    var appliedUpgrades = require(path.join(process.cwd(), 'package.json'))['stack-upgrades']
    var missingDependencies = []
    for (var key in upgradeMetaInfo.dependencies) {
      if (!appliedUpgrades[key]) {
        console.error('upgrade dependency not found:', key)
        missingDependencies.push(key)
      }
    }
    if (missingDependencies.length) {
      return next && next(new Error('missing dependencies: ' + missingDependencies.join(',')))
    }
  }

  var storeUpgrade = function (done) {
    var pjsonpath = path.join(process.cwd(), 'package.json')
    fs.readFile(pjsonpath, function (err, content) {
      if (err) return done(err)
      var packagejson = JSON.parse(content)
      packagejson['stack-upgrades'] = packagejson['stack-upgrades'] || {}
      packagejson['stack-upgrades'][upgradeMetaInfo.name] = upgradeMetaInfo.version
      console.info('updating package.json stack-upgrades ...')
      fs.writeFile(pjsonpath, JSON.stringify(packagejson, null, 2), done)
    })
  }

  var applyPeerUpgrades = function (done) {
    if (upgradeMetaInfo.peerUpgrades) {
      var appliedUpgrades = require(path.join(process.cwd(), 'package.json'))['stack-upgrades']
      var tasks = []
      for (var key in upgradeMetaInfo.peerUpgrades) {
        if (appliedUpgrades[key]) {
          tasks.push({
            upgradeRoot: path.join(templateRoot, upgradeMetaInfo.peerUpgrades[key])
          })
        }
      }
      async.eachSeries(tasks, function (taskInfo, nextTask) {
        console.info('apply peer upgrade', taskInfo.upgradeRoot.replace(process.cwd(), ''), '...')
        mergeStack(taskInfo.upgradeRoot, nextTask)
      }, function (err) {
        if (err) return done(err)
        if (tasks.length === 0) {
          console.warn('WARNING:', upgradeMetaInfo.name, 'has peer upgrades but none has been applied. Consider using', upgradeMetaInfo.peerUpgrades)
        }
        storeUpgrade(done)
      })
    } else {
      storeUpgrade(done)
    }
  }

  console.info('apply upgrade', upgradeRoot.replace(process.cwd(), ''), '...')
  mergeStack(upgradeRoot, function (err) {
    if (err) return next(err)
    applyPeerUpgrades(next)
  })
}

module.exports = function (angel) {
  var handleResult = function (done) {
    return function (err) {
      if (err) {
        console.error(err)
        if (done) return done(err)
        return process.exit(1)
      }

      var npmInstall = exec('npm install')
      npmInstall.stdout.pipe(process.stdout)
      npmInstall.stderr.pipe(process.stderr)

      npmInstall.on('exit', function (code) {
        if (code !== 0) return process.exit(code)
        console.info('all done, git diff & go')
        done && done()
      })
    }
  }

  angel.on('stack use :input', function (angel, done) {
    if (angel.cmdData.input.indexOf('git') > -1) {
      return angel.do('stack use ' + angel.cmdData.input + ' ./ master', done)
    }

    angel.do('stack list.json', function (err, upgrades) {
      if (err) return console.error('found error during angel stack list.json', err)
      var foundUpgradePath
      for (var i = 0; i < upgrades.length; i++) {
        if (upgrades[i].name === angel.cmdData.input) {
          foundUpgradePath = path.dirname(upgrades[i].fullPath)
        }
      }
      if (foundUpgradePath) {
        return applyStack({
          root: foundUpgradePath
        }, handleResult(done))
      }
      if (angel.cmdData.input.indexOf('/') !== 0 && angel.cmdData.input.indexOf(':\\') !== 1) {
        foundUpgradePath = path.join(process.cwd(), angel.cmdData.input)
      } else {
        foundUpgradePath = angel.cmdData.input
      }
      applyStack({
        root: foundUpgradePath
      }, handleResult(done))
    })
  })
  angel.on('stack use :source :updatePath', function (angel, done) {
    angel.do('stack use ' + angel.cmdData.source + ' ' + angel.cmdData.updatePath + ' master', done)
  })
  angel.on('stack use :source :updatePath :branch', function (angel, done) {
    require('angelabilities-exec')(angel)
    var options = {
      root: ''
    }
    var tasks = [
      // clone to a temporary folder
      function (next) {
        console.info('cloning upstream source ...')
        temp.mkdir('upstream', function (err, dirPath) {
          if (err) return next(err)
          options.root = path.join(dirPath, angel.cmdData.updatePath)
          angel.sh([
            'git clone ' + angel.cmdData.source + ' ' + dirPath,
            'cd ' + dirPath,
            'git checkout ' + angel.cmdData.branch
          ].join(' && '), next)
        })
      },
      // apply upgrade
      function (next) {
        applyStack(options, next)
      }
    ]

    async.eachSeries(tasks, function (task, next) {
      task(next)
    }, handleResult(done))
  })
  .example('$ angel stack use ...')
  .description('manage project\'s stack')
}
