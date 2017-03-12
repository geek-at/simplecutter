var currentvideo = '';

function combinevideos(videos)
{
    var fs = require('fs');
    console.log("combining "+ videos.length +" videos");
    startLoading()
    var bin = 'resources\\ffmpeg\\bin\\ffmpeg.exe';
    if (!fs.existsSync(bin)) {
        var bin = 'ffmpeg\\bin\\ffmpeg.exe';
    }
    var ffmpeg = require('fluent-ffmpeg');
    ffmpeg.setFfmpegPath(bin);
    
    var mergedname = calcName();

    var command = '';
    var outpath = require('path').dirname(videos[0].path)+"\\cut\\";
    if (!fs.existsSync(outpath)){
        fs.mkdirSync(outpath);
    }

    outpath+=mergedname;

    for (let f of videos)
    {
        var path = f.path;
        if(command=='')
            command = ffmpeg(path);
        else 
            command.input(path);
    }

    command.on('error', function(err) {
        console.log('An error occurred: ' + err.message);
        endLoading()
    })
    .on('end', function() {
        console.log('Merging finished !');
        const {shell} = require('electron')

        shell.showItemInFolder(outpath);
        endLoading();
        $("#video").html('<h2>Finished!</h2>\
        <p>New video name: '+mergedname+'</p>\
        <p>Path: '+outpath+'</p>\
        <video\
            id="video-active"\
            class="video-active"\
            width="640"\
            height="390"\
            controls="controls">\
            <source src="'+outpath+'" type="video/mp4">\
        </video>');
    })
    .mergeToFile(outpath, '.');

    /*
    var command = ffmpeg('C:\\Users\\Chris\\Videos\\Tom Clancy\'s Rainbow Six  Siege\\val_trick_1.mp4')
    .input('C:\\Users\\Chris\\Videos\\Tom Clancy\'s Rainbow Six  Siege\\val_trick_2.mp4')
    .on('error', function(err) {
        console.log('An error occurred: ' + err.message);
        endLoading()
    })
    .on('end', function() {
        console.log('Merging finished !');
        endLoading()
    })
    .mergeToFile('C:\\Users\\Chris\\Videos\\Tom Clancy\'s Rainbow Six  Siege\\merged.mp4', '.');
    */
}

function loadVideo(file)
{
    var path = require('path').dirname(file);
    
    currentvideo = file;
    console.log("loading "+file);
    var videotag = '<h2>Loaded "'+require('path').basename(file)+'"</h2>\
        <p>from path: '+path+'</p>\
        <video\
            id="video-active"\
            class="video-active"\
            width="640"\
            height="390"\
            controls="controls">\
            <source src="'+file+'" type="video/mp4">\
        </video>\
        <div>\
            Name of the new Video:<br/>\
            <input type="text" id="newname" value="'+calcName()+'"/>\
        </div>\
        <div id="current">0:00</div>\
        <div id="duration">0:00</div>\
        <button onClick="setStarttime()">Set starttime</button> <input id="starttime" type="text" placeholder="starttime"/><br/>\
        <button onClick="setEndtime()">Set endtime</button> <input id="endtime" type="text" placeholder="endtime"/>\
        <div class="checkbox">\
            <label><input id="nosound" checked type="checkbox" value="1">Remove sound</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="halfsize" type="checkbox" value="1">Half the resolution of the video</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="gif" type="checkbox" value="1">Create as gif (big files!)</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="pictshare" type="checkbox" checked value="1">Upload to PictShare after cut</label>\
        </div>\
        <button onClick="cutIt()">Cut it!</button>\
        <div class="progress">\
            <div class="progress-bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:0%">\
                0%\
            </div>\
        </div>\
        ';
    $("#video").html(videotag);

    $("#video-active").on(
    "timeupdate", 
    function(event){
      onTrackedVideoFrame(this.currentTime, this.duration);
    });
}

function calcName()
{
    var Sentencer = require('sentencer');
    return Sentencer.make("{{ noun }}{{ noun }}")+'.mp4';
}

function cutIt()
{
    var fs = require('fs');
    console.log("starting the cutting");
    startLoading()
    var cmd=require('node-cmd');
    var bin = 'resources\\ffmpeg\\bin\\ffmpeg.exe';
    if (!fs.existsSync(bin)) {
        var bin = 'ffmpeg\\bin\\ffmpeg.exe';
    }
    
    var path = require('path').dirname(currentvideo)+"\\cut";
    if (!fs.existsSync(path)){
        fs.mkdirSync(path);
    }

    var starttime = parseFloat($("#starttime").val());
    var duration = parseFloat($("#endtime").val());
    var outfile = path+'\\'+ $("#newname").val() ;
        

    var command = bin+" -y -i \""+currentvideo+"\" -ss "+ starttime + " -t "+ duration;

    if(document.getElementById('gif').checked)
    {
        outfile+='.gif';
        command+=" -r 15 -vf scale=640:-1";
    }

    if(document.getElementById('nosound').checked)
        command+=" -an";

    if(document.getElementById('halfsize').checked && !document.getElementById('gif').checked)
        command+=" -vf scale=iw*.5:ih*.5";

    

    command+=" "+'"'+outfile+'"';

    //console.log(command);

    cmd.get(
            command,
            function(data){
                console.log('finito',data);
                if(document.getElementById('pictshare').checked)
                    uploadFileToPictshare(outfile);
                else 
                    endLoading();
                if(!document.getElementById('gif').checked)
                    loadVideo(outfile);
                else
                    $("#video").html('<h2>Finished!</h2>\
                        <p>Path: '+path+'</p>\
                        <img src="'+outfile+'">');

                const {shell} = require('electron')

                shell.showItemInFolder(outfile);
            }
        );
}

function startLoading()
{
    $('#myModal').modal('show');
    $("#loading").html(getSpinner(true));
}

function endLoading()
{
    $('#myModal').modal('hide');
    $("#loading").html("");
}

function setStarttime()
{
    $("#starttime").val($("#current").text());
}

function setEndtime()
{
    var starttime = parseFloat($("#starttime").val());
    var current = parseFloat($("#current").text());
    $("#endtime").val(current-starttime);
}

function uploadFileToPictshare(file)
{
    $("#loadingtext").html('Uploading to PictShare');
    console.log("uploading to pictshare");
  var req = require('request').post('https://pictshare.net/backend.php', function (err, resp, body) {
  if (err) {
    console.log('Error!');
  } else {
    console.log('URL: ' + body);
    var o = JSON.parse(body);
    if(o.hash===undefined || !o.hash){
        endLoading()
        return false;
    }
    var url = 'https://pictshare.net/'+o.hash;
    const {shell} = require('electron')
    shell.openExternal(url);
    endLoading()
    }
  });
  var form = req.form();
  form.append('postimage', require('fs').createReadStream(file), {
    filename: 'postimage',
    contentType: 'text/plain'
  });
}