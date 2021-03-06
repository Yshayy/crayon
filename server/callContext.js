var path = require("path");
var fs = require("fs");
var url = require("url");
var zlib = require('zlib');
var countersLib = require("./counter.js");
var configLib = require("./configuration.js");
var path = require("path");
var util = require("util");
var staticDir = path.normalize(__dirname + '/../static');
var logger = require("./logger.js");
var urlUtils = require("./url-util.js");

// Constructor for each client call. This object is passed as a token between most functions
function CallContext(req, res) {
	var me=this;
	
	me.request = req;
	me.response = res;
	me.startTime = new Date().getTime();
	me.args = {};
	
	if (req.connection && req.connection.remoteAddress ) {
		me.remoteIP = req.connection.remoteAddress;
	} else if (req.socket && req.socket.remoteAddress ) {
		me.remoteIP = req.socket.remoteAddress;
	} else if (req.headers && req.headers["x-real-ip"]) {
		me.remoteIP = req.headers["x-real-ip"];
	}
	else {
		logger.warn("could not find remote IP address "+util.inspect(req));
	}
	

	// Parse request query args (not post body yet)
	var urlObj = url.parse(me.request.url); 
	me.uri = urlObj.pathname;
	if (me.uri == "/") {
		me.uri = configLib.getConfig().homePage;
	}
}

// Called to consolidate the names of the client arguments on each request to a shorter less space hogging format
CallContext.prototype.minifyArgNames = function(args) {
	var me = this;

	// Legend for each row (each row properties)
	// The rational behind the letters is 
	// Numbers get Large letters (one exception is m=min because M=max and it's appropriate)
	// m = min
	// M = max
	// N = samples
	// A = ave
	// V = n*variance
	// S = sum
	// t = time
	// n = name
	// # = row etag (modification count) <never received from client>
	// s = server
	// c = component

	if (args.min != null) 		{ args.m = args.min; delete args.min; }
	if (args.max != null) 		{ args.M = args.max; delete args.max; }
	if (args.samples != null) 	{ args.N = args.samples; delete args.samples; }
	if (args.ave != null) 		{ args.A = args.ave; delete args.ave; }
	if (args.stdevInc != null) 	{ args.V = args.stdevInc; delete args.stdevInc; }
	if (args.time != null) 		{ args.t = args.time; delete args.time; }
	if (args.name != null) 		{ args.n = args.name; delete args.name; }
	if (args.val != null) 		{ args.S = args.val; delete args.val; }
	if (args.server != null) 	{ args.s = args.server; delete args.server; }
	if (args.component != null)	{ args.c = args.component; delete args.component; }
};

// Each response to the client should pass through this function
CallContext.prototype.respondWithHeaders = function(code, headers, msg, msgType) {
	try {
		var me = this;

		// get total request time in ms
		var requestMs = new Date().getTime() - me.startTime;
		
		countersLib.getOrCreateCounter(countersLib.systemCounterDefaultInterval, "API call ms to " + me.uri, "crayon").addSample(requestMs);
		


		// Log errors
		if (code >= 400) {
			logger.error("Returning status " + code + " for error:\n" + JSON.stringify(msg).colorRed());
		}

		// If there was no messasge (e.g. 304)
		if (msg == null) {
			me.response.writeHeader(code, headers);  
			me.response.end();
			return;

		// If the message was binary (e.g. file we read from disk)
		} else if (msgType == "binary") {
			me.response.writeHeader(code, headers);
            me.response.write(msg, "binary");
            me.response.end();

        // Any other type of message should be stringified
		} else if (msgType != "binary" && typeof msg != "string") {
			msg = JSON.stringify(msg);
		}


		// Get the encoding the client supports
		var acceptEncoding = "default";
		if (me.request.headers && me.request.headers['accept-encoding']) {
			acceptEncoding = me.request.headers['accept-encoding'];
		}

		// If the encoding contains gzip, use gzip
		if (acceptEncoding.match(/\bgzip\b/)) {
		  	headers["content-encoding"] = "gzip";
		  	me.response.writeHeader(code, headers); 
		 	zlib.gzip(new Buffer(msg, "utf-8"), function(err, compressedMsgBuff) {
		 		if (err) {
		 			logger.error("failed gzipping reponse for client: " + err);
					me.response.end();
		 			return;
		 		}
		 		
		 		me.response.write(compressedMsgBuff, "binary");	
		 		me.response.end();
		 		return;
		 	});

		// If the encoding contains deflate, use deflate
		} else if (acceptEncoding.match(/\bdeflate\b/)) {
			headers["content-encoding"] = "deflate";
			me.response.writeHeader(code, headers);  
			zlib.deflate(new Buffer(msg, "utf-8"), function(err, compressedMsgBuff) {
				if (err) {
					logger.error("failed deflating reponse for client: " + err);				
					me.response.end();
					return;
				}
				
				me.response.write(compressedMsgBuff, "binary");									
				me.response.end();
				return;
			});

		// The client doesn't support any compression, simply flush the response
		} else {
			me.response.writeHeader(code, headers);  
			me.response.write(msg, msgType||"utf-8");								
			me.response.end();
			return;
		}
		
	} catch (ex) {
		logger.error("Failed responding to client: " + ex.stack);
		me.response.writeHeader(code, headers);  
		me.response.write("Failed responding: " + ex, "utf-8");						
		me.response.end();
	}
};

// A short method group for calling respondWithHeaders under different circumstances
CallContext.prototype.respondJson = function(code, msg, headers) { this.respondWithHeaders(code, headers || {"Content-Type": "text/json"}, msg); };
CallContext.prototype.respondText = function(code, msg, headers) { this.respondWithHeaders(code, headers || {"Content-Type": "text/plain"}, msg); };
CallContext.prototype.respondBinary = function(code, msg, headers) { this.respondWithHeaders(code, headers, msg, "binary"); };

CallContext.prototype.respondFile = function(code, headers) {
	var me = this;
	if (!me.isFileServing || me.filename == null) {
		me.respondText(500, "internal server error");
		logger.error("no file name");
		return;
	}

	logger.debug("Serving of file " + me.uri.colorBlue());
	var raw = fs.createReadStream(me.filename);
	var acceptEncoding = me.request.headers['accept-encoding'];
	if (!acceptEncoding) {
		acceptEncoding = '';
	}

	if (acceptEncoding.match(/\bdeflate\b/)) {
		headers['content-encoding'] = 'deflate';
		me.response.writeHead(code, headers);
		raw.pipe(zlib.createDeflate()).pipe(me.response);
	} else if (acceptEncoding.match(/\bgzip\b/)) {
		headers['content-encoding'] = 'gzip';
		me.response.writeHead(code, headers);
		raw.pipe(zlib.createGzip()).pipe(me.response);
	} else {
		me.response.writeHead(code, headers);
		raw.pipe(me.response);
	}

	return;
};


// Convert the argument to json and abort request if it's not
CallContext.prototype.jsonifyArg = function(arg) {
 	var me = this;
 	try {
 		if (me.args[arg]) me.args[arg] = JSON.parse(me.args[arg]);
 		return true;
 	} catch (ex) {
 		me.respondText(400, "Failed parsing argument '" + arg + "': " + ex);
 		return false;
 	}
};

// Convert the argument to number and abort the request if it's not (with support for array of arguments)
CallContext.prototype.numberifyArg = function(arg, index) {
 	var me = this;

 	// Prepare the power for the decimal point rounding, should the configuration exist
	var pow = null;
	var config = configLib.getConfig();
	if (config != null && config.decimalPointRounding != null) {
		pow = Math.pow(10,config.decimalPointRounding);
	}

 	try {

 		// If we were supplied with an index then args is probably an array and the arg exists at a certain index
 		if (index != null) {
 			if (me.args[index][arg] != null) {
	 			me.args[index][arg] = Number(me.args[index][arg]);
	 			if (isNaN(me.args[index][arg])) me.args[index][arg] = null; // be liberal, don't throw
	 			else if (pow != null) me.args[index][arg] = Math.round(me.args[index][arg]*pow)/pow;
	 		}

	 	// We were not supplied an index, simply convert the argument to a number
 		} else {
	 		if (me.args[arg] != null) {
	 			me.args[arg] = Number(me.args[arg]);
	 			if (isNaN(me.args[arg])) me.args[arg] = null; // be liberal, don't throw
	 			else if (pow != null) me.args[arg] = Math.round(me.args[arg]*pow)/pow;
	 		}
 		}

 		return true;
 	} catch (ex) {
 		me.respondText(400, "Failed parsing argument '" + arg + "': " + ex);
 		return false;
 	}
};

// Parsing the arguments whether they are of a get request or a post request alike
CallContext.prototype.parseArgs = function(callback) {
	var me = this;
	var request = me.request;
	me.args = {};
	
	// If the request is a post request - this is async due to the post body arrival
	if (request.method == "POST") {

		// Read the body of the post request
		var body = '';
		request.on('data', function (data) { body += data; });
		request.on('end', function () {
			me.body = body;
			
			/*
			if (message.data[0] == 0x1f && message.data[1] == 0x8b) {
					try {
						zlib.gunzip(message.data, function(err, uncompressedMsgBuff) {
					 		if (err) {
					 			logger.error("failed gunzipping RabbitMQ message: " + err);
					 			return;
					 		}
					 		
					 		handleMessage(uncompressedMsgBuff);
					 		return;
					 	});
					} catch (ex) {
						logger.error("Error decompressing RabbitMQ message: " + ex.stack);
						return;
					}
				} else {
					handleMessage(message.data);
				}				*/

			// Try to convert the post body into a json arguments object
			try {
				me.args = JSON.parse(body);
				callback(null);
			}
			catch (ex) {
				callback("Error handling post request from " + me.remoteIP + ": " + ex.stack);
			}
			
		});

	// Assume it's a get request (we don't have anything else at the moment) - this is sync
	} else {

		// Parse the get query arguments line
		var urlObj = url.parse(request.url);
		if (urlObj.query && urlObj.query.length > 0) {
			
			// Split the query line to key value strings
			var queryVarsKV = urlObj.query.split('&');
			
			// Parse each of the key value pairs we have and store in the arguments object
			for (var i = 0; i < queryVarsKV.length; i++) {
				var firstEquals = queryVarsKV[i].indexOf('=');
				var key = queryVarsKV[i].substring(0,firstEquals);
				var value = queryVarsKV[i].substring(firstEquals + 1);
				me.args[decodeURIComponent(key)] = decodeURIComponent(value);
			}
		}

		// Notify completion
		callback(null);
	}
};

var mimeTypes = {
		".js": "text/javascript", 
		".html": "text/html",
		".htm": "text/html",
		".txt": "text/plain",
		".json": "text/json",
		".conf": "text/html",
		".ico": "image/x-icon",
		".gif": "image/gif",
		".jpg": "image/jpg", 
		".png": "image/png", 
		".css": "text/css"
};
var defaultMimeType = "application/octet-stream";

// Get the proper mime type for our files (we don't use that many in our server)
var getEndingContentType = function(filename){
	try {
		var ext = path.extname(filename);
		var rt = mimeTypes[ext];
		if (typeof rt != "string")
			return defaultMimeType;
		return rt;
	}
	catch (ex) {
		logger.error("could not extract mime type from "+filename+", "+ex);
		return defaultMimeType;
	}
};

// Serve the file requested with support for 304 not modified
CallContext.prototype.getRequestedFile = function() {
	var me=this;

	// Mark this request as a file serving
	me.isFileServing = true;
	var base = null;
	if (me.uri.indexOf("/plugins/") == 0) {
		base = __dirname;
	} else {
		base = staticDir;
	}
	
	me.filename = path.join(base, me.uri);
	
	if (!urlUtils.validateUrlString(me.filename, base)) {
		me.respondText(401, "illegal URL");
		logger.error("illegal URL: " + me.filename);
		return;
	}

	// Check for the file to serve's existnace
	fs.exists(me.filename, function(exists) {
		if(!exists) {
			logger.error("Requested file (" + me.filename + ") was not found");  
			me.respondText(404, "404 Not Found\n");
			return;
		}
		
		// Check for the file modification date and content length to build an etag (for 304 responses)
		fs.stat(me.filename, function(err, stat) {
			if (err) {			
				logger.error("Failed accessing file (" + me.uri + ") to client. Error: " + err);  
				me.respondText(500, "500 Internal Server Serror: Error reading file\n");
				return;
			}

			// Get the mime type of our served file
			var contentType = getEndingContentType(me.filename);

			// Build an etag that the client browser will keep to check against on its next call
			etag = stat.size + '-' + Date.parse(stat.mtime);

			// Compile a list of the response headers we want to send to the client
			var responseHeaders = {
				"Content-Type": contentType, 
				"Last-Modified": stat.mtime,
				"ETag": etag,
				};

			// don't cache htmls, they're not that big and it's easier to edit them on production
			// Note: Should consider to remove on a real production environemnt
			// For all other types, try to return 304 if the browser's etag matches our file's
			if (contentType != "text/html" && 
				me.request.headers['if-none-match'] === etag) {
				//TODO:REVIEW - Why is text/html etag check not enough?
				me.respondText(304,null,responseHeaders);
				return;
			}
			
			me.respondFile(200, responseHeaders);
		});
	});
};

module.exports.mockCallContext = function(requestUrl, onEnd, args) {
	var me=this;
	var mockRequest = {url: requestUrl};
	var mockResponse = { 
		writeHeader: function(code, headers) {
			me.headers=headers;
			me.code = code;
		},
		write: function(body,encoding) {
			me.body = body;
			me.encoding = encoding;
		},
		end: function() {
			onEnd();
		}
	};
	var callContext = new CallContext(mockRequest, mockResponse);
	callContext.parseArgs(function() {});
	if (args != null) callContext.args = args;
	callContext.verbose = false;
	return callContext;
};


module.exports.CallContext = CallContext;