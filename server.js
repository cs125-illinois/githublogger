#!/usr/bin/env node

require('dotenv').config()
const _ = require('lodash')
const expect = require('chai').expect

const http = require('http')
const githubWebhookHandler = require('github-webhook-handler')
const mongo = require('mongodb').MongoClient
const bunyan = require('bunyan')
const moment = require('moment')
const log = bunyan.createLogger({
  name: 'githublogger',
  streams: [
    {
      type: 'rotating-file',
      path: 'logs/githublogger.log',
      period: '1d',
      count: 365,
      level: 'info'
    }
  ]
})
const RSMQ = require('rsmq-promise')
const rsmq = new RSMQ({ host: '127.0.0.1', port: 6379, ns: 'githubgrader' })

const jsYAML = require('js-yaml')
const fs = require('fs')
const defaults = {
  port: 8188
}
const argv = require('minimist')(process.argv.slice(2))
let config = _.extend(
  defaults,
  jsYAML.safeLoad(fs.readFileSync('config.yaml', 'utf8')),
  argv
)
let PrettyStream = require('bunyan-prettystream')
let prettyStream = new PrettyStream()
prettyStream.pipe(process.stdout)
if (config.debug) {
	log.addStream({
		type: 'raw',
		stream: prettyStream,
		level: "debug"
	})
} else {
	log.addStream({
		type: 'raw',
		stream: prettyStream,
		level: "warn"
	})
}
log.debug(config)

const webhookHandler = githubWebhookHandler({
  path: '/',
  secret: process.env.GITHUB_SECRET
})

let github
webhookHandler.on('push', async push => {
  try {
    log.info(push)

    push._id = push.id
    delete (push.id)
    push.received = moment().toDate()

    await github.update({ _id: push._id }, push, { upsert: true })
    let response = await rsmq.sendMessage({
      qname: "push",
      message: push._id
    })
    expect(response).to.be.ok
    log.debug(`Sent message for push ${ push._id }`)
  } catch (err) {
    log.fatal(err)
  }
})
webhookHandler.on('error', err => { log.debug(err) })

mongo.connect(process.env.MONGO)
  .then(client => {
    github = client.db(config.database).collection('github')
    http.createServer((request, response) => {
      webhookHandler(request, response, err => {
        log.warn(`${request.url} caused error: ${err}`)
        response.statusCode = 404
      })
    }).listen(config.port)
  })

// vim: ts=2:sw=2:et:ft=javascript
