describe('stack use', function () {
  it('works with directory input', function (done) {
    var Angel = require('organic-angel')
    var angel = new Angel()
    var path = require('path')
    var temp = require('temp')

    require('../scripts/use')(angel)
    require('../scripts/list')(angel)

    temp.track()// Automatically track and cleanup files at exit
    temp.mkdir('stack-use-directory-input', function (err, dirPath) {
      if (err) return done(err)
      var cwd = process.cwd()
      process.chdir(dirPath)
      angel.do('stack use ' + path.join(__dirname, 'data', 'test-stack-upgrade'), function (err) {
        if (err) return done(err)
        console.log('done')
        process.chdir(cwd)
        done()
      })
    })
  })
})
