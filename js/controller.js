//global vars
var npslogtype = undefined;

const holder = document.getElementById('main');
  holder.ondragover = () => {
    return false;
  }
  holder.ondragleave = holder.ondragend = () => {
    return false;
  }
  holder.ondrop = (e) => {
    e.preventDefault()
    if(e.dataTransfer.files.length==1)
      for (let f of e.dataTransfer.files)
      {
        console.log('File(s) you dragged here: ', f.path)
        loadVideo(f.path)
      }
    else 
      combinevideos(e.dataTransfer.files);
    return false;
  }

function onTrackedVideoFrame(currentTime, duration){
    $("#current").text(currentTime);
    $("#duration").text(duration);
}

function getSpinner(withtext)
{
    return (withtext===true?'<h3 id="loadingtext" class="text-center">Processing.. </h3>':'')+'<div class="sk-cube-grid">\
                <div class="sk-cube sk-cube1"></div>\
                <div class="sk-cube sk-cube2"></div>\
                <div class="sk-cube sk-cube3"></div>\
                <div class="sk-cube sk-cube4"></div>\
                <div class="sk-cube sk-cube5"></div>\
                <div class="sk-cube sk-cube6"></div>\
                <div class="sk-cube sk-cube7"></div>\
                <div class="sk-cube sk-cube8"></div>\
                <div class="sk-cube sk-cube9"></div>\
            </div>';
}