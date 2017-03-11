var currentvideo = '';
function loadVideo(file)
{
    currentvideo = file;
    console.log("loading "+file);
    var videotag = '\
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
    
    var path = require('path').dirname(currentvideo);

    var starttime = parseFloat($("#starttime").val());
    var duration = parseFloat($("#endtime").val());
    var outfile = '"'+path+'\\'+ $("#newname").val() +'"';

    console.log(outfile);

    var command = bin+" -y -i \""+currentvideo+"\" -ss "+ starttime + " -t "+ duration;

    if(document.getElementById('nosound').checked)
        command+=" -an";

    if(document.getElementById('halfsize').checked)
        command+=" -vf scale=iw*.5:ih*.5";

    

    command+=" "+outfile;

    //console.log(command);

    cmd.get(
            command,
            function(data){
                console.log('finito',data);
                endLoading();
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
