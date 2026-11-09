self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{
  let d={title:"Arch's Arc",body:""};
  try{d=Object.assign(d,e.data.json());}catch(x){try{d.body=e.data.text();}catch(y){}}
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,tag:d.tag||undefined,icon:"/icon-192.png",badge:"/icon-192.png"}));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{for(const c of cs){if("focus" in c)return c.focus();}return self.clients.openWindow("/");}));
});
