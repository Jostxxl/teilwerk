export function manualFinFailureMessage(reason=''){
 if(/short|span/i.test(reason))return 'Die Finnenlinie ist zu kurz. Zwei weiter auseinanderliegende Modellpunkte wählen.';
 if(/sticks out|can.t reach|above another|floor|blocked/i.test(reason))return 'Der Weg zur Druckplatte ist durch Modellgeometrie versperrt. Eine frei erreichbare Unterseite oder eine andere Drucklage wählen.';
 if(/plate|low|height/i.test(reason))return 'Die Finnenlinie liegt zu nahe an der Druckplatte. Einen höheren Bereich am Modell wählen.';
 if(/surface|face|patch/i.test(reason))return 'Entlang dieser Linie wurde keine passende Modellfläche gefunden. Zwei Punkte auf derselben erreichbaren Fläche wählen.';
 return 'An dieser Stelle kann keine passende Finne aufgebaut werden. Eine andere Linie oder Drucklage wählen.';
}
