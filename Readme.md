
# knox

 Node Amazon S3 Client.

## Features

  - Not outdated :), developed for node 0.2.x
  - RESTful api (`client.get()`, `client.put()`, etc)
  - Uses node's crypto library (fast!, the others used native js)
  - Very node-like low-level request api via `http.Client`
  - Highly documented

## Authors

  - TJ Holowaychuk ([visionmedia](http://github.com/visionmedia))

## Examples

The following examples demonstrate some capabilities of knox and the s3 REST API. First things first, create an s3 client:

    var client = knox.createClient({
        key: '<api-key-here>'
      , secret: '<secret-here>'
      , bucket: 'learnboost'
    });

### PUT

Below we do several things, first we read _Readme.md_ into memory,
and initialize a client request via `client.put()`, passing the destination
filename as the first parameter (_/test/Readme.md_), and some headers. Then
we listen for the _response_ event, just as we would for any `http.Client` request, if we have a 200 response, great! output the destination url to stdout.

    fs.readFile('Readme.md', function(err, buf){
      var req = client.put('/test/Readme.md', {
          'Content-Length': buf.length
        , 'Content-Type': 'text/plain'
      });
      req.on('response', function(res){
        if (200 == res.statusCode) {
          console.log('saved to %s', req.url);
        }
      });
      req.end(buf);
    });

By default the _x-amz-acl_ header is _public-read_, meaning anyone can __GET__ the file. To alter this simply pass this header to the client request method. Note that the field name __MUST__ be lowercase, do not use 'X-Amz-Acl' etc, as this will currently result in duplicate headers (although different case).

    client.put('/test/Readme.md', { 'x-amz-acl': 'private' });

Each HTTP verb has an alternate method with the "File" suffix, for example `put()` also has a higher level method named `putFile()`, accepting a src filename and performs the dirty work shown above for you. Here is an example usage:

    client.putFile('my.json', '/user.json', function(err, res){
      // Logic
    }); 

Another alternative is to stream via `Client#putStream()`, for example:

    var stream = fs.createReadStream('data.json');
    client.putStream(stream, '/some-data.json', function(err, res){
      // Logic
    });

An example of moving a file:

    client.put('0/0/0.png', {
        'Content-Type': 'image/jpg',
        'Content-Length': '0',
        'x-amz-copy-source': '/test-tiles/0/0/0.png',
        'x-amz-metadata-directive': 'REPLACE'
    }).on('response', function(res) {
      // Logic
    }).end();

### GET

Below is an example __GET__ request on the file we just shoved at s3, and simply outputs the response status code, headers, and body.

    client.get('/test/Readme.md').on('response', function(res){
      console.log(res.statusCode);
      console.log(res.headers);
      res.setEncoding('utf8');
      res.on('data', function(chunk){
        console.log(chunk);
      });
    }).end();

## DELETE

Delete our file:

    client.del('/test/Readme.md').on('response', function(res){
      console.log(res.statusCode);
      console.log(res.headers);
    }).end();

Likewise we also have `client.deleteFile()` as a more concise (yet less flexible) solution:

    client.deleteFile('/test/Readme.md', function(err, res){
      // Logic
    });
    
### Stream Multipart

The streamMultipart method allows users to upload files to a path in s3 (this does not include the specified bucket) as a multipart operation using Node-formidable to parse the upload form, where 'request' is the form post request. Returns an event listener for the knox client. 

    var listener = client.streamMultipart(request, "path/in/s3");
    
    //include a new file name without an extension (the extension is added dynamically)
    var listener = client.streamMultipart(request, "path/in/s3", "myNewFileName");
    
### Get Multipart Uploads

The getMultipartUploads method with return an array of all uploads currently in progress to the designated call back function.

    client.getMultipartUploads(function(uploads) {
      ...do something with the uploads
    });
    
### Abort Uploads

The abortMultipart method aborts the specified upload given the key (the path of the file, not including the bucket) and the upload Id of the specified upload. Below we abort all existing uploads if there are any uploads to abort.

    client.getMultipartUploads(function(uploads) {
      if (uploads) {
        for (var i = 0; i < uploads.length; i++) {
          client.abortMultipart(uploads[i].UploadId, "/"+uploads[i].Key);
        }
      }
    });

## Running Tests

To run the test suite you must first have an S3 account, and create
a file named _./auth_, which contains your credentials as json, for example:

    {"key":"<api-key-here>",
     "secret":"<secret-here>",
     "bucket":"<your-bucket-name>"}

Then simply execute:

    $ make test
    
## Events Emitted
* formdata - (Multipart streaming)Emitted when a part of the Multipart form has been parsed
* streaming - (Multipart streaming)Emitted once all parts are being streamed to s3
* part - (Multipart streaming)Emitted for each part on the stream as it is written to s3
* complete - (Multipart streaming)Emitted once the upload is complete and in s3
* abort - (Multipart streaming)Emitted upon a successful abort

## License 

(The MIT License)

Copyright (c) 2010 LearnBoost &lt;dev@learnboost.com&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
