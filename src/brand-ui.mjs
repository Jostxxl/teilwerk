// Theme and common toolbar. Guided navigation belongs to main.mjs.
const $=id=>document.getElementById(id);
$('studioImport').addEventListener('click',()=>$('file').click());
$('drop').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('file').click();}});
$('wire').addEventListener('click',()=>{$('wire').setAttribute('aria-pressed',String($('wire').getAttribute('aria-pressed')!=='true'));});
function theme(value){document.documentElement.dataset.theme=value;const light=value==='light',label=light?'Dunkles Erscheinungsbild':'Helles Erscheinungsbild';$('studioTheme').textContent=light?'☾':'☼';$('studioTheme').title=label;$('studioTheme').setAttribute('aria-label',label);try{localStorage.setItem('prinjekt-studio-theme',value);}catch{}}
let savedTheme;try{savedTheme=localStorage.getItem('prinjekt-studio-theme');}catch{}theme(savedTheme==='light'?'light':'dark');
$('studioTheme').addEventListener('click',()=>theme(document.documentElement.dataset.theme==='light'?'dark':'light'));
