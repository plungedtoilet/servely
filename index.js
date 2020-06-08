const cluster = require('cluster');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const EventEmitter = require('events');


/*

HandlerPath will be path to handler file which exports function.

SuperServer Options:
  'count': Worker count. Defaults to cpu coore count.
  'certPath': Path to certificate in case of https. Defaults to null.
  'keyPath': Path to key in case of https. Defaults to null.
  'express': Whether to use express. Defaults to false.

Communications between master and slave should be of the format:
  {
    cmd: "",
    content: JSON-able value
  }
*/
let id = 0;

class SuperServer extends EventEmitter {
  constructor (handlerPath, options) {
    super();
    const workers = [];
    Object.defineProperty(this, "workers", {
      get: ()=>workers
    });
    Object.defineProperty(this, "handlerPath", {
      value: handlerPath
    });
    Object.defineProperty(this, "options", {
      value: Object.assign({
        count: os.cpus().length,
        certPath: null,
        keyPath: null,
        express: false,
        port: 8080
      }, options)
    });
    Object.defineProperty(this, "id", {
      value: ++id
    });
    let ready = 0;
    if (
      (this.options.keyPath !== null && this.options.certPath === null) ||
      (this.options.certPath !== null && this.options.keyPath === null)
    ) throw new Error('HTTPS Error. Missing certificate or public key.');
    cluster.on('online', (worker)=>{
      workers.push(worker);
      worker.send({
        cmd: "greet",
        content: Object.assign({
          handlerPath: this.handlerPath
        }, this.options)
      });
      if (this.options.count === ++ready) this.emit("online");
    })
    cluster.setupMaster({
      exec: path.resolve(__dirname, __filename)
    });
    for (let i = 0; i < this.options.count; i++) {
      cluster.fork({
        "PARENT_ID": `SuperServer:${this.id}`,
        "PARENT_CWD": process.cwd()
      });
    }
    this.listen = this.listen.bind(this);
  }
  listen (port) {
    //If port is set it serves on that port. otherwise, it uses the init port.
    this.workers.forEach((worker) => {
      if (typeof(port) === "undefined") {
        worker.send({
          cmd: "listen"
        });
      } else {
        worker.send({
          cmd: "listen",
          content: port
        });
      }
    });

  }
}

module.exports = SuperServer;

if (cluster.isMaster) {

} else if (cluster.isWorker) {
  const id = cluster.worker.id;
  const scope = {
    handler: null,
    keyPath: null,
    certPath: null,
    port: null,
    express: null
  };
  cluster.worker.on('message', (message)=>{
    switch (message.cmd) {
      case "greet":
        scope.handler = require(path.resolve(process.env.PARENT_CWD, message.content.handlerPath));
        scope.certPath = message.content.certPath;
        scope.keyPath = message.content.keyPath;
        scope.port = message.content.port;
        scope.express = message.content.express;
        break;
      case "listen":
        if ("content" in message)
          scope.port = message.content;
        if (scope.keyPath === null && scope.certPath === null) {
          //HTTP
          if (!scope.express) {
            //Not using express
            const server = http.createServer(scope.handler);
            server.listen(scope.port, (err)=>{
              if (err) {
                console.error(err);
              } else {
                console.log(`${process.env.PARENT_ID}:${id} serving on port ${scope.port}...`);
              }
            });
          } else {
            //Using Express.
            const app = express();
            const server = http.createServer(app);
            scope.handler(app);
            server.listen(scope.port, (err)=>{
              if (err) {
                console.error(err);
              } else {
                console.log(`${process.env.PARENT_ID}:${id} serving on port ${scope.port}...`);
              }
            });
          }
        } else {
          //HTTPS
          if (!scope.express) {
            //Not using express
            const server = https.createServer({
              key: fs.readFileSync(scope.keyPath),
              cert: fs.readFileSync(scope.certPath)
            }, scope.handler);
            server.listen(scope.port, (err)=>{
              if (err) {
                console.error(err);
              } else {
                console.log(`${process.env.PARENT_ID}:${id} serving on port ${scope.port}...`);
              }
            });
          } else {
            //Using Express.
            const app = express();
            const server = https.createServer({
              key: fs.readFileSync(scope.keyPath),
              cert: fs.readFileSync(scope.certPath)
            }, app);
            scope.handler(app);
            server.listen(scope.port, (err)=>{
              if (err) {
                console.error(err);
              } else {
                console.log(`${process.env.PARENT_ID}:${id} serving on port ${scope.port}...`);
              }
            });
          }
        }
        break;
      default:
        console.error("Worker recieved unknown command.")
    }
  })
}
