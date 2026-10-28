var u=location.origin+'/',t='Appsign: traductor de lengua de señas argentina (prototipo)';
document.getElementById('wa').href='https://wa.me/?text='+encodeURIComponent(t+' '+u);
document.getElementById('share').onclick=function(){if(navigator.share){navigator.share({title:'Appsign',text:t,url:u}).catch(function(){})}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){alert('Link copiado')})}else{prompt('Copiá el link:',u)}};
