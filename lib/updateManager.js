import fs from 'fs-extra'
import path from 'path'
import os from 'os'
import axios from 'axios'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
const exec=promisify(execFile)
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const plugins=path.join(root,'plugins')
export async function listPlugins(){await fs.ensureDir(plugins);return (await fs.readdir(plugins)).filter(x=>x.endsWith('.js'))}
export async function installPlugin(name,url){if(!/^[a-zA-Z0-9_-]{1,40}$/.test(name))throw new Error('Invalid plugin name');if(!/^https:\/\//i.test(url))throw new Error('Plugin URL must use HTTPS');await fs.ensureDir(plugins);const r=await axios.get(url,{responseType:'text',timeout:30000,maxContentLength:512*1024});const target=path.join(plugins,`${name}.js`);await fs.writeFile(target,String(r.data));return target}
export async function removePlugin(name){if(!/^[a-zA-Z0-9_-]{1,40}$/.test(name))throw new Error('Invalid plugin name');const target=path.join(plugins,`${name}.js`);await fs.remove(target);return target}
export async function updateFromZip(url){if(!/^https:\/\//i.test(url))throw new Error('Update URL must use HTTPS');const tmp=path.join(os.tmpdir(),`stain-update-${Date.now()}.zip`);const backup=path.join(root,`backup-${new Date().toISOString().replace(/[:.]/g,'-')}`);await fs.ensureDir(backup);await exec('node',['-e',`console.log('preflight')`]);const r=await axios.get(url,{responseType:'arraybuffer',timeout:120000,maxContentLength:25*1024*1024});await fs.writeFile(tmp,r.data);await fs.copy(path.join(root,'data'),path.join(backup,'data'),{overwrite:true}).catch(()=>{});await fs.copy(path.join(root,'auth_info_baileys'),path.join(backup,'auth_info_baileys'),{overwrite:true}).catch(()=>{});await fs.copy(path.join(root,'.env'),path.join(backup,'.env'),{overwrite:true}).catch(()=>{});return {backup,tmp,notice:'Archive downloaded and protected data backed up. Restart/update extraction should be performed by the deployment environment.'}}
