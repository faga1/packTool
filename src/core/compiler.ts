import { SyncHook } from "tapable";
import type { Program,Node } from 'estree'
import { UnixPath,checkFile} from "./util.js";
import type {Options} from '../type.js'
import MagicString from 'magic-string';
import fs from 'fs'
import path from 'path'
import acorn, { parse } from 'acorn'
import type {rule,Entry,Chunk} from '../type.js'

export default class Compiler{
    options:Options;
    hooks:Record<string,InstanceType<typeof SyncHook>>
    rootPath:string;
    entry:InstanceType<typeof Set>;
    module:InstanceType<typeof Set>;
    chunk:InstanceType<typeof Set>;
    alreadyModule:InstanceType<typeof Set>;
    assets:Record<string,any>;
    files:InstanceType<typeof Set>
    fs:any
    dev:boolean
    constructor(options:any){
        this.options= options
        this.hooks = {
            run: new SyncHook(),
            emit: new SyncHook(),
            done: new SyncHook()
        }
        this.rootPath = UnixPath(process.cwd())
        this.entry = new Set<Entry>()
        this.module = new Set<any>()
        this.chunk = new Set<any>()
        this.alreadyModule = new Set<any>()
        this.assets = {}
        this.files = new Set<any>()
        this.fs = fs
        this.dev = false;
    }
    run(){
        this.hooks.run.call('')
        this.buildEntry()
        this.buildChunk()
        this.exportFile()
    }
    buildEntry(){
        if(typeof this.options.entry === 'string'){
            this.options.entry = [this.options.entry] 
        }
        this.options.entry.forEach(item=>{
            let entryObj:Entry= this.buildModule(item,UnixPath(path.resolve(this.rootPath,item)))
            entryObj.name = Array.from(item.matchAll(/.*\/(.*)\.(j|t)s$/g))[0][1]
            this.entry.add(entryObj)
        })
    }
    buildModule(moduleName:string,modulePath:string){
        const originCode = fs.readFileSync(modulePath,'utf-8')
        const module = this.moduleCompiler(moduleName,modulePath,originCode)
        if(!module) return;
        const completedCode = this.loadLoader(modulePath,module.source)
        module.source = completedCode
        return module;
    }
    moduleCompiler(moduleName:string,modulePath:string,code:string){
        const module = {
            name:moduleName,
            id:modulePath,
            dependenices:new Set(),
            source:''
        }
        if(this.options.format === 'esm'){
            code = this.compileCommonJs(code)
        }
        const reg = /\bimport\ (.*) from\ (.*)/g
        const s = new MagicString(code);
        for(const moduleItem of Array.from(code.matchAll(reg))){
            const tempItem = moduleItem as any;
            s.overwrite(tempItem.index,tempItem.index+moduleItem[0].length,'')
            const requirePath = moduleItem[2].slice(1,-1)
            const moduleDir = path.dirname(modulePath)
            const moduleId = UnixPath(path.resolve(moduleDir,requirePath))
            if(this.alreadyModule.has(moduleId)) continue;
            let requireModule = this.buildModule(requirePath,moduleId)
            module.dependenices.add(requireModule)
            this.module.add(requireModule)
            this.alreadyModule.add(moduleId)
        }
        const exReg = /\bexport/g
        for(const moduleItem of Array.from(code.matchAll(exReg))){
            const tempItem = moduleItem as any;
            s.overwrite(tempItem.index,tempItem.index+tempItem[0].length,'')
        }
        module.source = s.toString()
        return module
    }
    compileCommonJs(code:string):string{
        const reg = /\w*\x20*({?\w*}?)\x20*=\x20*\brequire\((.*)\)/g
        const s = new MagicString(code)
        for(const item of Array.from(code.matchAll(reg))){
            let str = item[1]
            if(str[0]==='{'&&str[str.length-1]==='}'){
                str = str.slice(1,-1)
            }
            s.overwrite(item.index,item.index+item[0].length,`import {${item[1]}} from '${item[2].slice(1,-1)}'`)
        }
        // const exReg = /\bexports|\bmodule.exports()/
        return s.toString();
    }
    loadCommonModule(code:string){
        // const reg = //
    }
    loadLoader(modulePath,code){
        if(!this.options.module||!this.options.module.rules.length) return;
        const rules:rule[] = Array.from(this.options.module.rules);
        rules.forEach(item => {
            if(item.test.test(modulePath)){
                item.test.lastIndex = 0;
                item.include.forEach(loader => {
                    code = loader(code)
                })
            }
        })
        return code
    }
    buildChunk(){
        for(const item of this.entry){
            const entry = item as Entry
            const chunk ={
                name:entry.name,
                dependenices:entry.dependenices,
                id:entry.id,
                source:entry.source,
                modules:[]
            }
            this.addMoudle(chunk.dependenices,chunk.modules)
            this.chunk.add(chunk)
        }
    }
    addMoudle(dep,arr){
        const iterator = dep.entries()
        for(const module of iterator){
            if(module[0].dependenices.size){
                this.addMoudle(module[0].dependenices,arr)
            }
            arr.push(module[0])
        }
    }
    exportFile(){
        for(const item of this.chunk){
            const chunk = item as Chunk
            this.assets[chunk.name] = this.getSourceModule(chunk)
        }
        this.hooks.emit.call('plugin1')  
        let keyArr=Object.keys(this.assets)
        for(let i=0;i<keyArr.length;i++){
            this.writeFile(keyArr[i])

        }
        
    }
    checkFile(path:string):Promise<boolean>{
        return new Promise((resolve)=>{
            if(this.dev){
                const fileExist = this.fs.existsSync(path)
                if(!fileExist) resolve(false)
                else resolve(true)
            }else{
                fs.access(path,(err)=>{
                    if(err){
                        resolve(false)
                    }else{
                        resolve(true)
                    }
                })
            }
        })
    }
    async writeFile(assetKey){
        this.files.add(this.assets[assetKey])
        const dirExist = await this.checkFile(`${this.dev?'':this.rootPath}/dist`)
        if(!dirExist) this.fs.mkdirSync(`${this.dev?'':this.rootPath}/dist`)
        const fileExist = await this.checkFile(`${this.dev?'':this.rootPath}/dist/output[${assetKey}].js`)
        this.fs.writeFileSync(`${this.dev?'':this.rootPath}/dist/output[${assetKey}].js`,this.assets[assetKey])
        if(this.dev) this.addPublic()
    }
    async addPublic(){
        const dirExist = await this.checkFile(`${this.rootPath}/public`)
        if(!dirExist) return
        const dir = fs.readdirSync(`${this.rootPath}/public`)
        for(const filepath of dir){
            const content = fs.readFileSync(`${this.rootPath}/public/`+filepath,'utf-8')
            console.log(filepath);
            this.fs.writeFileSync('/'+filepath,content)
        }
    }
    getSourceModule(chunk){
        const {source,modules} = chunk
        return `${modules.map(item=>item.source)}${source}`
    }
}