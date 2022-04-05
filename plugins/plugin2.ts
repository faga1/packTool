import Compiler from '../src/compiler'
export default class plugin2{
    compiler:InstanceType<typeof Compiler>
    constructor(compiler:InstanceType<typeof Compiler>){
        this.compiler = compiler;
    }
    apply(){
        this.compiler.hooks.run.tap('plugin2',()=>{console.log('plugin2')})
    }
}