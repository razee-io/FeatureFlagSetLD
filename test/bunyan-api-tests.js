var assert = require('chai').assert;

describe('bunyan-api', function () {
  afterEach(function () {
  });

  after (function(){
    delete require.cache[require.resolve('../src/bunyan-api')];
  });

  describe('#createLogger()', function () {
    it('should create logger with specified env var LOG_LEVEL=warn (40)', function () {
      process.env.LOG_LEVEL = 'warn';
      var log = require('../src/bunyan-api').createLogger();
      assert.equal(log.streams[0].level, 40, 'should be at log level warn(40)');
    });

    it('should create logger with log level info(30) when no LOG_LEVEL specified', function () {
      delete process.env.LOG_LEVEL;
      var log = require('../src/bunyan-api').createLogger();
      assert.equal(log.streams[0].level, 30, 'should be at log level info(30)');
    });

    it('should create logger with log level info(30) when unknown LOG_LEVEL specified', function () {
      process.env.LOG_LEVEL = 'unknownLevelName';
      var log = require('../src/bunyan-api').createLogger();
      assert.equal(log.streams[0].level, 30, 'should be at log level info(30)');
    });
  });
});
