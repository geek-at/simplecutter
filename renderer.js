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
            <label><input id="nosound" type="checkbox" value="1">Remove sound</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="halfsize" type="checkbox" value="1">Half the resolution of the video</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="gif" type="checkbox" value="1">Create as gif (big files!)</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="pictshare" type="checkbox" value="1">Upload to PictShare after cut</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="fps" type="checkbox" value="1">Set to 30 FPS</label>\
        </div>\
        <div class="checkbox">\
            <label><input id="nvenc" type="checkbox" value="1">(beta) Use GPU encoding</label>\
        </div>\
        \
        <div class="radio">\
            <label><input type="radio" name="speedchange" value="4">Quater speed</label>\
        </div>\
        <div class="radio">\
            <label><input type="radio" name="speedchange" value="2">Half speed</label>\
        </div>\
        <div class="radio">\
            <label><input type="radio" name="speedchange" checked value="1">Normal speed</label>\
        </div>\
        <div class="radio">\
            <label><input type="radio" name="speedchange" value="0.5">2x faster</label>\
        </div>\
        <div class="radio">\
            <label><input type="radio" name="speedchange" value="2">4x faster</label>\
        </div>\
        <button onClick="cutIt()">Cut it!</button>\
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

    var ffmpeg = require('fluent-ffmpeg');
    var command = ffmpeg(currentvideo);
    command.setFfmpegPath('ffmpeg/bin/ffmpeg.exe');
    command.setFfprobePath('ffmpeg/bin/ffprobe.exe');

    if(document.getElementById('gif').checked)
    {
        outfile+='.gif';
        command.fps(15).size('640x?');
    }

    if(document.getElementById('nosound').checked)
        command.noAudio();

    if(document.getElementById('fps').checked && !document.getElementById('gif').checked)
        command.fps(30);
        
    if(document.getElementById('halfsize').checked && !document.getElementById('gif').checked)
        command.size('50%');

    if(document.getElementById('nvenc').checked && !document.getElementById('gif').checked)
        command.videoCodec('h264_nvenc')
    
    var playbackspeed = parseFloat($('input[name="speedchange"]:checked').val());


    //var command = bin+" -y -i \""+currentvideo+"\" -ss "+ starttime + " -t "+ (duration*playbackspeed) + commandattachments;
    

    //command+=" "+'"'+outfile+'"';

    command.output(outfile).seek(starttime).duration(duration*playbackspeed)
        .videoFilters('setpts='+playbackspeed+'*PTS')
        .on('end', function() {
        console.log('Finished processing');
        const {shell} = require('electron')
        shell.showItemInFolder(outfile);
        if(document.getElementById('pictshare').checked)
            uploadFileToPictshare(outfile);
        else 
            endLoading();
      }).on('progress', function(progress) {
        setProgress(progress.percent);
        console.log('Processing: ' + progress.percent + '% done');
      })
      .run();

    //console.log(command);

    /*
    cmd.get(
            command,
            function(data){
                console.log('finito',data);
                if(document.getElementById('pictshare').checked)
                    uploadFileToPictshare(outfile);
                else 
                    endLoading();
                const {shell} = require('electron')

                shell.showItemInFolder(outfile);
            }
        );
    */
}

function setProgress(value) {
    var elem = document.getElementById("progressbar"); 
    var width = 1;
    elem.style.width = Math.round(value) + '%'; 
    elem.innerHTML = Math.round(value) + '%';
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