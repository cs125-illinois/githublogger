#!/usr/bin/env node

require('dotenv').config()
const _ = require('lodash')
const debug = require('debug')('githublogger')
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
const RSMQ = require('rsmq')
const rsmq = new RSMQ({ host: '127.0.0.1', port: 6379, ns: 'gitgrader' })

const argv = require('minimist')(process.argv.slice(2))
const defaults = {
  port: 8188
}
let config = _.extend(_.clone(defaults), argv)
debug(config)

const webhookHandler = githubWebhookHandler({
  path: '/',
  secret: process.env.GITHUB_SECRET
})

let github
webhookHandler.on('push', push => {
  log.info(push)

  push._id = push.id
  delete (push.id)
  push.examined = false
  push.done = false
  push.received = moment().toDate()

  github.update({ _id: push._id }, push, { upsert: true })
  rsmq.sendMessage({
    qname: "gitgrader",
    message: push._id
  }, (err, resp) => {
    expect(resp).to.be.ok
  })
})
webhookHandler.on('error', err => { log.debug(err) })

mongo.connect(process.env.MONGO)
  .then(client => {
    github = client.db('MPs').collection('github')
    http.createServer((request, response) => {
      webhookHandler(request, response, err => {
        log.debug(`${request.url} caused error: ${err}`)
        response.statusCode = 404
      })
    }).listen(config.port)
  })

// vim: ts=2:sw=2:et:ft=javascript
