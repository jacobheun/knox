
/*!
 * knox - Client
 * Copyright(c) 2010 LearnBoost <dev@learnboost.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var utils = require('./utils')
  , auth = require('./auth')
  , http = require('http')
  , url = require('url')
  , join = require('path').join
  , mime = require('./mime')
  , emitter = require('events').EventEmitter
  , formidable = require('formidable')
  , uuid = require('node-uuid')
  , xml2js = require('./node-xml2js/lib/index.js')
  , fs = require('fs');

/**
 * Initialize a `Client` with the given `options`.
 * 
 * Required:
 *
 *  - `key`     amazon api key
 *  - `secret`  amazon secret
 *  - `bucket`  bucket name string, ex: "learnboost"
 *
 * @param {Object} options
 * @api public
 */

var Client = module.exports = exports = function Client(options) {
  this.host = 's3.amazonaws.com';
  this.emitter = new emitter();
  utils.merge(this, options);
  if (!this.key) throw new Error('aws "key" required');
  if (!this.secret) throw new Error('aws "secret" required');
  if (!this.bucket) throw new Error('aws "bucket" required');
};

/**
 * Request with `filename` the given `method`, and optional `headers`.
 *
 * @param {String} method
 * @param {String} filename
 * @param {Object} headers
 * @return {ClientRequest}
 * @api private
 */

Client.prototype.request = function(method, filename, headers){
  var options = { host: this.host, port: 80 }
    , path = join('/', this.bucket, filename)
    , date = new Date
    , headers = headers || {};

  // Default headers
  utils.merge(headers, {
      Date: date.toUTCString()
    , Host: this.host
  });

  // Authorization header
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , date: date
    , resource: url.parse(path).pathname
    , contentType: headers['Content-Type']
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });

  // Issue request
  options.method = method;
  options.path = path;
  options.headers = headers;
  var req = http.request(options);
  req.url = this.url(filename);

  return req;
};

/**
 * Streams files from a file uploader directly to amazon using node-formidable
 *
 * @param {Object} request The upload request from the form
 * @param {String} destDir[optional] The directory in the specified bucket in which to put the file
 * @param {String} fileName[optional]
 * @param {Function} fn Callback function upon upload completion
 */

Client.prototype.streamMultipart = function(request, destDir, fileName) {
  var self = this;
  
  self.parts = [];
  self.partTags = [];
  self.currentPart = 0;
  self.partCount = 1;
  self.receivedLength = 0;
  self.destDir = destDir || "";
  self.incForm = new formidable.IncomingForm();
  self.stream = self.incForm.parse(request);
  
  self.stream.onPart = function(part) {

    if (part.filename) {
      if (fileName && self.getExt(part.filename)) {
        self.filename = fileName + self.getExt(part.filename);
      }
      self.filename = self.filename || part.filename;
      part.addListener('end', function() {
        self.initiateMultipart();
      });
      
      part.addListener('data', function(data) {
        //check to see if the part has enough data (AWS min = 5mb except last chunk)
        if (self.parts[self.partCount - 1]) {
          if (self.parts[self.partCount - 1].length >= 5 * 1024 * 1024) {
            self.partCount++;
            self.parts[self.partCount - 1] = data.toString('binary');
            self.receivedLength += data.length;
          } else {
            self.parts[self.partCount - 1] += data.toString('binary');;
            self.receivedLength += data.length;
          }
        } else {
          self.parts[self.partCount - 1] = data.toString('binary');;
          self.receivedLength += data.length;
        }
      });
    } else {
      self.emit('formdata', part);
    }
  };  
 
 return self.emitter; 
};

/**
 * Initiates the upload with AWS
 *
 * @api private
 */

Client.prototype.initiateMultipart = function() {
  var self = this;
  
  self.client = http.createClient(80, this.host);
  
  var path = join('/', self.destDir || "", self.filename )
    , date = new Date
    , method = "POST"
    , headers = {};
    
  headers = utils.merge({
      Expect: '100-continue'
    , 'x-amz-acl': 'public-read'
    , Date: date.toUTCString()
    , Host: this.bucket + "." + this.host
  }, headers);

  // Authorization header
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , date: date.toUTCString()
    , resource: "/" + this.bucket + path + '?uploads'
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });

  self.client.on('error', function(err){
    self.emit('error', err);
  });
  
  var req = self.client.request(method, path + '?uploads', headers);
    
  req.end();
  req.on('response',function(resp) {
    var xmlResponse = "";
    resp
      .on('data', function(data) {
        xmlResponse += data;
      })
      .on('end', function() {
        delete self.xmlParser;
        self.xmlParser = new xml2js.Parser();
        self.xmlParser.addListener('end', function(result) {
          if (result && result.UploadId) {
            self.uploadId = result.UploadId;
            self.uploadPart(null, path);
            self.emit('streaming',result);
          } else {
            self.emit("error", "Upload Id not returned");
          }
        });
        self.xmlParser.parseString(xmlResponse);
      });
  });
};

/**
 * Uploads the next part in the upload process
 *
 * @param {Object} part The part to be uploaded (null if not designated)
 * @param {String} path The path of the file to upload the part to
 *
 * @api private
 */
 
Client.prototype.uploadPart = function(part, path) {
  var self = this;
    
  var date = new Date
    , headers = {}
    , method = "PUT"
    , uploadData = path + "?partNumber=" + (self.currentPart + 1) + "&uploadId=" + self.uploadId;

  // Default headers
  headers = utils.merge({
      Expect: '100-continue'
    , "Content-Length": self.parts[self.currentPart].length
    , Date: date.toUTCString()
    , Host: this.bucket + "." + this.host
  }, headers);

  // Authorization header
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , date: date.toUTCString()
    , resource: "/" + this.bucket + uploadData
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });
  
  self.partsReq = self.client.request(method, uploadData, headers);

  self.partsReq.on('response',function(resp) {
    var xmlResponse = "";
    resp
      .on('end', function() {
        self.partTags.push(resp.headers.etag);
        
        if (self.partTags.length >= self.partCount) {
          self.completeMultipart(path);
        }
      });
  });
  
  var partToUpload = part || self.parts[self.currentPart];
  if (partToUpload) {
    self.partsReq.write(partToUpload, "binary");
    self.emit('part',partToUpload);
    self.partsReq.end();
  }
  
  if (++self.currentPart < self.partCount) {
    self.uploadPart(null, path);
  }
};

/**
 * Completes the upload
 *
 * @param {String} path
 *
 * @api private
 */
 
Client.prototype.completeMultipart = function(path) {
  var self = this;
  
  var date = new Date
    , method = "POST"
    , headers = {};
    
  headers = utils.merge({
      Expect: '100-continue'
    , "Content-Length": self.receivedLength
    , Date: date.toUTCString()
    , Host: this.bucket + "." + this.host
  }, headers);

  // Authorization header
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , date: date.toUTCString()
    , resource: "/" + this.bucket + path + '?uploadId=' + self.uploadId
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });
  
  var req = self.client.request(method, path + '?uploadId=' + self.uploadId, headers)
    , xml = self.buildCompleteXml();
  req.end(xml);
  req.on('response',function(resp) {
    var xmlResponse = "";
    resp
      .on('data', function(data) {
        xmlResponse += data;
      })
      .on('end', function() {
        delete self.xmlParser;
        self.xmlParser = new xml2js.Parser();
        self.xmlParser.addListener('end', function(result) {
          if (result && result.Error) {
            self.abortMultipart(self.uploadId, path);
            self.emit("error",result.Error);
          }
          self.emit('complete',result);
        });
        self.xmlParser.parseString(xmlResponse);
      });
  });
};

/**
 * Aborts the multipart upload of the specified uploadId at the specified path
 *
 * @param {String} uploadId The id of the multipart returned from AWS
 * @param {String} path The location of the upload on s3
 *
 * @api public
 */

Client.prototype.abortMultipart = function(uploadId, path) {
  var self = this;
  
  var client = http.createClient(80, this.host)
    , date = new Date
    , headers = {}
    , method = "DELETE";

  // Default headers
  headers = utils.merge({
      Expect: '100-continue'
    , Date: date.toUTCString()
    , Host: this.bucket + "." + this.host
  }, headers);

  // Authorization header
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , date: date.toUTCString()
    , resource: "/" + this.bucket + path + '?uploadId=' + uploadId
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });

  client.on('error', function(err){
    self.emit('error', err);
  });
  
  var req = client.request(method, path + '?uploadId=' + uploadId, headers);
  req.end();
  req.on('response',function(resp) {
    var xmlResponse = "";
    resp
      .on('data', function(data) {
        xmlResponse += data;
      })
      .on('end', function() {
        console.log(resp.statusCode + " Abort Data:\n"+xmlResponse);
        self.emit('abort',resp);
      });
  });
};

/**
 * Returns a list of active (incomplete) uploads
 *
 * @param {Function} fn Callback function
 * @return {Array}
 * @api public
 */

Client.prototype.getMultipartUploads = function(fn) {
  var self = this;
  
  var client = http.createClient(80, this.host)
    , date = new Date
    , headers = {}
    , method = "GET";
    
  headers = utils.merge({
      Expect: '100-continue'
    , Date: date.toUTCString()
    , Host: this.bucket + "." + this.host
  }, headers);
  
  // Authorization header
  headers.Authorization = auth.authorization({
      key: this.key
    , secret: this.secret
    , verb: method
    , date: date.toUTCString()
    , resource: "/" + this.bucket + "/" + '?uploads'
    , amazonHeaders: auth.canonicalizeHeaders(headers)
  });

  client.on('error', function(err){
    self.emit('error', err);
  });
  var req = client.request(method, '/?uploads', headers);
  req.end();
  req.on('response',function(resp) {
    var xmlResponse = "";
    resp
      .on('data', function(data) {
        xmlResponse += data;
      })
      .on('end', function() {
        delete self.xmlParser;
        self.xmlParser = new xml2js.Parser();
        self.xmlParser.addListener('end', function(result) {
          if (!result) { 
            fn(null);
          }  else if (result.length) {
            fn(result.Upload);
          } else {
            fn([result]);
          }
        });
        self.xmlParser.parseString(xmlResponse);
      });
  });
};

/**
 * Builds the xml needed to complete the upload
 *
 * @api private
 */

Client.prototype.buildCompleteXml = function() {
  var self = this
    , xml = "\n<CompleteMultipartUpload>\n";

  for (var i = 0; i < self.parts.length; i++) {
    xml += '\t<Part>\n'
        + '\t\t<PartNumber>' + (i+1) + '</PartNumber>\n'
        + '\t\t<ETag>' + self.partTags[i] + '</ETag>\n'
        + '\t</Part>\n';
  }
  
  xml += "</CompleteMultipartUpload>";
  
  return xml;
};

/**
 * Gets the extension of the file
 *
 * @param {String} fileName
 * returns {String}
 */
Client.prototype.getExt = function(fileName) {
  return fileName.substring(fileName.lastIndexOf('.'), fileName.length) || null;
}

/**
 * PUT data to `filename` with optional `headers`.
 *
 * Example:
 *
 *     // Fetch the size
 *     fs.stat('Readme.md', function(err, stat){
 *      // Create our request
 *      var req = client.put('/test/Readme.md', {
 *          'Content-Length': stat.size
 *        , 'Content-Type': 'text/plain'
 *      });
 *      fs.readFile('Readme.md', function(err, buf){
 *        // Output response
 *        req.on('response', function(res){
 *          console.log(res.statusCode);
 *          console.log(res.headers);
 *          res.on('data', function(chunk){
 *            console.log(chunk.toString());
 *          });
 *        }); 
 *        // Send the request with the file's Buffer obj
 *        req.end(buf);
 *      });
 *     });
 *
 * @param {String} filename
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.put = function(filename, headers){
  headers = utils.merge({
      Expect: '100-continue'
    , 'x-amz-acl': 'public-read'
  }, headers || {});
  return this.request('PUT', filename, headers);
};

/**
 * PUT the file at `src` to `filename`, with callback `fn`
 * receiving a possible exception, and the response object.
 *
 * NOTE: this method reads the _entire_ file into memory using
 * fs.readFile(), and is not recommended or large files.
 *
 * Example:
 *
 *    client
 *     .putFile('package.json', '/test/package.json', function(err, res){
 *       if (err) throw err;
 *       console.log(res.statusCode);
 *       console.log(res.headers);
 *     });
 *
 * @param {String} src
 * @param {String} filename
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.putFile = function(src, filename, headers, fn){
  var self = this;
  if ('function' == typeof headers) {
    fn = headers;
    headers = {};
  };
  fs.readFile(src, function(err, buf){
    if (err) return fn(err);
    headers = utils.merge({
        'Content-Length': buf.length
      , 'Content-Type': mime.lookup(src)
    }, headers);
    self.put(filename, headers).on('response', function(res){
      fn(null, res);
    }).end(buf);
  });
};

/**
 * PUT the given `stream` as `filename` with optional `headers`.
 *
 * @param {Stream} stream
 * @param {String} filename
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.putStream = function(stream, filename, headers, fn){
  var self = this;
  if ('function' == typeof headers) {
    fn = headers;
    headers = {};
  };
  fs.stat(stream.path, function(err, stat){
    if (err) return fn(err);
    // TODO: sys.pump() wtf?
    var req = self.put(filename, utils.merge({
        'Content-Length': stat.size
      , 'Content-Type': mime.lookup(stream.path)
    }, headers));
    req.on('response', function(res){
      fn(null, res);
    });
    stream
      .on('error', function(err){fn(null, err); })
      .on('data', function(chunk){ req.write(chunk); })
      .on('end', function(){ req.end(); });
  });
};

/**
 * GET `filename` with optional `headers`.
 *
 * @param {String} filename
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.get = function(filename, headers){
  return this.request('GET', filename, headers);
};

/**
 * GET `filename` with optional `headers` and callback `fn`
 * with a possible exception and the response.
 *
 * @param {String} filename
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.getFile = function(filename, headers, fn){
  if ('function' == typeof headers) {
    fn = headers;
    headers = {};
  }
  return this.get(filename, headers).on('response', function(res){
    fn(null, res);
  }).end();
};

/**
 * Issue a HEAD request on `filename` with optional `headers.
 *
 * @param {String} filename
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.head = function(filename, headers){
  return this.request('HEAD', filename, headers);
};

/**
 * Issue a HEAD request on `filename` with optional `headers` 
 * and callback `fn` with a possible exception and the response.
 *
 * @param {String} filename
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.headFile = function(filename, headers, fn){
  if ('function' == typeof headers) {
    fn = headers;
    headers = {};
  }
  return this.head(filename, headers).on('response', function(res){
    fn(null, res);
  }).end();
};

/**
 * DELETE `filename` with optional `headers.
 *
 * @param {String} filename
 * @param {Object} headers
 * @return {ClientRequest}
 * @api public
 */

Client.prototype.del = function(filename, headers){
  return this.request('DELETE', filename, headers);
};

/**
 * DELETE `filename` with optional `headers` 
 * and callback `fn` with a possible exception and the response.
 *
 * @param {String} filename
 * @param {Object|Function} headers
 * @param {Function} fn
 * @api public
 */

Client.prototype.deleteFile = function(filename, headers, fn){
  if ('function' == typeof headers) {
    fn = headers;
    headers = {};
  }
  return this.del(filename, headers).on('response', function(res){
    fn(null, res);
  }).end();
};

/**
 * Return a url to the given `filename`.
 *
 * @param {String} filename
 * @return {String}
 * @api public
 */

Client.prototype.url = function(filename){
  return 'http://' + this.bucket + '.' + this.host + join('/', filename);
};

/**
 * Return an S3 presigned url to the given `filename`.
 *
 * @param {String} filename
 * @param {Date} expiration
 * @return {String}
 * @api public
 */

Client.prototype.signedUrl = function(filename, expiration){
  var epoch = Math.floor(expiration.getTime()/1000);
  var signature = auth.signQuery({
    secret: this.secret,
    date: epoch,
    resource: '/' + this.bucket + url.parse(filename).pathname
  });
  
  return this.url(filename) + 
    '?Expires=' + epoch +
    '&AWSAccessKeyId=' + this.key +
    '&Signature=' + escape(signature);
};

/**
 * Emits events for this client
 *
 * @param {String} eventToEmit
 * @param {Object} obj The accompanying item to emit
 */

Client.prototype.emit = function(eventToEmit, obj) {
  this.emitter.emit(eventToEmit, obj);
};

/**
 * Shortcut for `new Client()`.
 *
 * @param {Object} options
 * @see Client()
 * @api public
 */

exports.createClient = function(options){
  return new Client(options);
};
