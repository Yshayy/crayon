var queryArgs = {};
(function () {
	var match,
		pl     = /\+/g,  // Regex for replacing addition symbol with a space
		search = /([^&=]+)=?([^&]*)/g,
		decode = function (s) { return decodeURIComponent(s.replace(pl, " ")); },
		query  = window.location.toString().split("?")[1]||"";

	while (match = search.exec(query))
	   queryArgs[decode(match[1])] = decode(match[2]);
})();

var setHeader = function(name) {
	$("#frameHeader").get()[0].innerHTML = name;
}

function readCookie(name) {
    return (name = new RegExp('(?:^|;\\s*)' + ('' + name).replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)').exec(document.cookie)) && name[1];
}
var themeCookie = readCookie("theme");
var theme = queryArgs.theme || themeCookie;

var head = $("head");
var body = $("body");

/* CRAYON MAIN UI START */
body.append('<div id="titleHeader"><img src="/CrayonsSmall.png"><img src="/CrayonTitleSmall.png">' +
	  '<span id="themeSelectBlock">Theme:<select onchange="selectTheme()" id="themeSelect">' +
	  '<option>default</option>' +
	  '<option>ambiance</option>' +
	  '</select></span></div>');

head.append('<script type="text/javascript" src="/html2canvas.js"></script>');
head.append('<link rel="stylesheet" type="text/css" href="/crayon.css" media="screen" />');
if (theme) {
	if (theme != "default") {
		head.append('<link rel="stylesheet" type="text/css" href="/themes/' + theme + '.css" media="screen" />');
	}
	themeSelect.value = theme;
}

function setTheme(t) {
	document.cookie = 'theme=' + t + '; expires=Tue, 1 Jan 2030 00:00:00 UTC; path=/'
}

if (queryArgs.theme) {
	setTheme(queryArgs.theme);
}

function selectTheme() {
	setTheme(themeSelect.value);
	window.location.reload();
}

body.append('<div id="frameHeader" class="frameHeader"></div>');
body.append('<div id="ddblueblockmenu">' +
				'<div class="menutitle">General</div>' + 
				'<ul>' + 
					'<li><a href="/designer.html">Dashboard Designer</a></li>' + 
					'<li><a href="/config.html">Configuration</a></li>' + 
				'</ul>' + 
				'<div class="menutitle">Dasboards</div>' + 
				'<ul id="dashboardsUL">' + 
				'</ul>' +
			'</div>');

$.ajax({
	url: "/dashboards",
	dataType: 'json',
	success: function(result) {
		var ul = $("#dashboardsUL");
		for (i in result) {
			ul.prepend('<li><a href="' + result[i].uri + '">' + result[i].name + '</a></li>');
		}
	}
});

$.ajax({
	url: "/dashboards.conf",
	success: function(result) {
		var lines = result.split('\n');
		var ul = $("#dashboardsUL");

		for (var i = 0; i < lines.length; ++i) {
			var line = lines[i].trim();

			if (line.length == 0) continue;
			if (line[0] == "#") continue;

			var parts = line.split('=');
			if (parts.length < 2) continue;
			var name = parts[0].trim();
			var url = parts[1].trim();
			ul.prepend('<li><a href="/by-json.html?url=' + url + '">' + name + '</a></li>');
		}
	}
});

body.append('<div class="verticalRuler"></div>');

/* CRAYON MAIN UI END */

/* CRAYON ALERT START */
body.append('<div id="alertOverlay" class="overlay"><div id="crayonAlert">'+
			'<div id="crayonAlertUpperBar">Some Alert text</div>'+
			'<div id="crayonAlertText">Some alert text with long wrapping should go here because its usually a long text</div>'+
			'<div id="crayonAlertBottomBar">'+
			'	<span class="crayonButton" id="crayonAlertOK" onclick="alertOK()" style="float:right;">OK</span>'+
			'	<span class="crayonButton" id="crayonAlertCancel" onclick="alertCancel()" style="float:right;margin-right:10px">Cancel</span>'+
			'</div></div>');

// Set action menu
body.append('<div class="graphMenuOptions" style="width: 55px">	\
				<ul class="list">	\
					<li onclick="doActionOnGraphDiv(this)">Refresh</li>	\
					<li onclick="doActionOnGraphDiv(this)">View Code</li>	\
					<li onclick="doActionOnGraphDiv(this)">Hide</li>	\
					<li onclick="doActionOnGraphDiv(this)">Get Image</li>	\
				</ul>	\
			</div>');
var graphMenuOptionsJQ = $(".graphMenuOptions");
var graphDivMenuIsShownTo = null;
function showOptionsForGraph(graphDiv) {
	if (graphDivMenuIsShownTo == graphDiv) {
		graphMenuOptionsJQ.css("opacity", 0);
		setTimeout(function() { graphMenuOptionsJQ.css("display", "block"); }, 200);
		graphDivMenuIsShownTo = null;
	} else {
		var divJQ = $(graphDiv.parentNode);
		var pos = divJQ.position();
		graphMenuOptionsJQ.css('left', pos.left + divJQ.width()).css('top', pos.top);
		graphMenuOptionsJQ.css("display", "block");
		setTimeout(function() { graphMenuOptionsJQ.css("opacity", 0.98); }, 200);
		graphDivMenuIsShownTo = graphDiv;
	}
}
function doActionOnGraphDiv(graphMenuOptionItem) {
	var action = graphMenuOptionItem.innerHTML;
	if (action == "Refresh") {
		window.refreshGraph(graphDivMenuIsShownTo);
	} else if (action == "View Code") {
		window.codeGraph(graphDivMenuIsShownTo);
	} else if (action == "Hide") {
		window.hideGraph(graphDivMenuIsShownTo.parentNode);
	} else if (action == "Get Image") {
		html2canvas(graphDivMenuIsShownTo.parentNode, {
		  onrendered: function(canvas) {
		  	showAlert({OK:true, title:"Right click and Save As", el:canvas});
		    //document.body.appendChild(canvas);
		  }
		});
	}

	// Toggle it off;
	showOptionsForGraph(graphDivMenuIsShownTo);
}

var OK = 1;
var CANCEL = 0;
var lastAlertOptions = null;
var showAlert = function(options, callback) {
	//options.title
	//options.text
	//options.OK
	//options.Cancel
	//options.autoSize
/*	left:300; 
	top:200;
	width:300px;
	height:150px; */
	if (options.el) {
		var padding = Number($(crayonAlertText).css("padding").replace("px",""))
		$(crayonAlert).css("width", options.el.width + (padding * 2));
		$(crayonAlertText).css("height", options.el.height);
		//(padding * 2) + 20 + 20
		$(crayonAlert).css("height", options.el.height + 95);
	} else {
		$(crayonAlert).css("width", 300);
		$(crayonAlert).css("height", 150);
		$(crayonAlertText).css("height", 55);
	}
	

	crayonAlertOK.style.display = options.OK ? "block" : "none";
	crayonAlertCancel.style.display = options.Cancel ? "block" : "none";
	crayonAlertUpperBar.innerHTML = options.title;
	lastAlertOptions = options;

	if (options.el) {
		if (options.el.tagName == "CANVAS") {
			$(crayonAlertText).html('<IMG src="' +options.el.toDataURL()+ '">');
		} else {
			$(crayonAlertText).html(options.el);
		}
	} else if (options.text) {
		crayonAlertText.innerHTML = options.text;
	}

	$("#alertOverlay").css("display", "block");
	setTimeout(function() { $("#alertOverlay").css("opacity", 0.98); }, 200);
}
var hideAlert = function() {
	if (progressInterval != null) clearTimeout(progressInterval);
	$("#alertOverlay").css("opacity", 0);
	setTimeout(function() { $("#alertOverlay").css("display", "none"); }, 200);
}

var alertOK = function() {
	hideAlert();
	if (lastAlertOptions.alertCallback != null) lastAlertOptions.alertCallback(OK);
}

var alertCancel = function() {
	hideAlert();
	if (lastAlertOptions.alertCallback != null) lastAlertOptions.alertCallback(CANCEL);
}

/* CRAYON ALERT END */

/* CRAYON PROGRESS OVERLAY  */
body.append('<div id="progressOverlay" class="overlay">' + 
				'<div class="progressText">Progress Text</div><br>' + 
				'<div class="meter animate">' + 
					'<span id="meterBar" style="width: 0%"><span>' + 
				'</div>' + 
			'</div>');

var setProgressText = function(text) {
	$(".progressText").get()[0].innerHTML = text;
}
var setProgressPercent = function(pct) {
	$("#meterBar").width(pct + "%");
}

var progressInterval;
var showLoadingGraphDataOverlay = function() {
	showOverlay();
	setProgressText("Loading Graph Data");
	var progressPct = 5;
	progressInterval = setInterval(function() {
		if (progressPct < 100) progressPct += 1;
		if (progressPct > 100) progressPct = 100;
		setProgressPercent(progressPct);

		if (progressPct == 100) {
			hideOverlay();
		}
	}, 100);
}

var showOverlay = function() {
	setProgressText("");
	setProgressPercent(0);
	$("#progressOverlay").css("display", "block");
	setTimeout(function() { $("#progressOverlay").css("opacity", 1); }, 200);
}

var hideOverlay = function() {
	if (progressInterval != null) clearTimeout(progressInterval);
	$("#progressOverlay").css("opacity", 0);
	setTimeout(function() { $("#progressOverlay").css("display", "none"); }, 200);
}
/* CRAYON PROGRESS END  */


/*
var all = document.getElementsByTagName("*");
for (var i=0, max=all.length; i < max; i++) {
     // Do something with the element here
}
*/