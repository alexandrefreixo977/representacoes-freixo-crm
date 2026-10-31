// One palette shared by every calendar view and its legend.
export const agendaTypes = [
 {key:'visit',label:'Visita',color:'#27689b',background:'#eaf3fb',aliases:['visita','visita comercial','visit']},
 {key:'meeting',label:'Reunião',color:'#7854a3',background:'#f2edf9',aliases:['reuniao','meeting']},
 {key:'call',label:'Chamada',color:'#237759',background:'#eaf5ee',aliases:['chamada','chamada telefonica','telefonema','call']},
 {key:'followup',label:'Follow-up',color:'#b35922',background:'#fff0e5',aliases:['follow-up','follow up','followup']},
 {key:'task',label:'Tarefa',color:'#9a7516',background:'#faf3d9',aliases:['tarefa','task']},
 {key:'presentation',label:'Apresentação',color:'#1d7b83',background:'#e6f5f5',aliases:['apresentacao','presentation']},
 {key:'proposal',label:'Envio de proposta',color:'#aa456e',background:'#fbeaf1',aliases:['envio de proposta','proposta enviada','proposta','proposal']},
 {key:'reminder',label:'Lembrete',color:'#5966a8',background:'#edf0fb',aliases:['lembrete','reminder']},
 {key:'email',label:'Email',color:'#826548',background:'#f3eee6',aliases:['email','e-mail']},
 {key:'other',label:'Outro',color:'#687480',background:'#eef1f4',aliases:['outro','nota','note']},
];
export function agendaType(type:string){
 const normalized=type.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 return agendaTypes.find(t=>t.aliases.includes(normalized))??agendaTypes[agendaTypes.length-1];
}

