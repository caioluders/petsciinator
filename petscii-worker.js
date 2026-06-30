importScripts('petscii-rom.js','petscii-core.js');

const core=PETSCIICore.create({
  upperRomBase64:PETSCII_ROM.UP_B64,
  lowerRomBase64:PETSCII_ROM.LOW_B64
});

self.onmessage=e=>{
  const {id,image,options}=e.data;
  try{
    const result=core.convertImageData(image,options);
    self.postMessage({id,result},[result.data.buffer]);
  }catch(err){
    self.postMessage({id,error:err&&err.message?err.message:String(err)});
  }
};
