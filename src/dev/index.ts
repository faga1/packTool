import type {Options} from '../type'
import Compiler from '../core/compiler.js'
import Server from './server.js'
import {getOptions} from '../core/packTool.js'
import packTool from '../core/packTool.js'

async function startDevServer(){
    
    try{
        var {compiler,options} = await packTool()
        compiler.run()
    }catch(err){
        console.log(err)
    }
    try{
        var server = new Server(compiler,options)
    }catch(err){
        console.log(err);
    }
}
startDevServer()