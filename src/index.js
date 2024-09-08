import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { jwt } from 'hono/jwt'
import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'

import { sign } from 'jsonwebtoken'
import { setCookie } from 'hono/cookie'

import Database from 'better-sqlite3'
import crypto from 'crypto'

import Mustache from 'mustache'
import fs from 'fs'
import path from 'path'

const app = new Hono()
const JWT_SECRET = 'your-secret-key'

const db = new Database('users.db')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT 
  )
`)

const hashPassword = (password) => {
  return crypto.createHash('sha256').update(password).digest('hex')
}

const addUser = (username, password) => {
  const hashedPassword = hashPassword(password)
  const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password) values (?,?)')
  stmt.run(username, hashedPassword)
}

const readTemplate = (templateName) => {
  return fs.readFileSync(path.join(__dirname, 'templates', `${templateName}.html`), 'utf8')
}

addUser('user', 'pass')

app.get('/', (c) => {
  return c.text('Hello Hono !')
})

// Swagger UI setup
app.get('/ui', swaggerUI({url: '/doc'}))

app.get('/login', (c) => {

//  return c.html(`
//    <!DOCTYPE html>
//    <html lang="en">
//
//      <head>
//        <meta charset="UTF-8">
//        <meta name="viewport" content="width=device-width, initial-scale=1.0">
//        <title>Login</title>
//      </head>
//
//      <body>
//        <h1>Login</h1>
//        <form action="/login" method="POST">
//          <input type="text" name="username" placeholder="Username" required><br>
//          <input type="password" name="password" placeholder="Password" required><br>
//          <button type="submit">Login</button>
//        </form>
//      </body>
//
//    </html>
//    `)


  let isAjax = false 
  
  if ( c.req.header('X-Alpine-Request') === "true")
    isAjax = true 

  let rendered = ''

  console.log('req header ->', c.req.header('X-Alpine-Request'))
  console.log("isAjax ->", isAjax)

  if ( isAjax ){
    const loginFragment = readTemplate('login')

    return c.html(loginFragment)
  } else {
    const layout = readTemplate('layout')
    const loginFragment = readTemplate('login')
    rendered = Mustache.render(layout, { title: 'Login' }, { content: loginFragment })

    return c.html(rendered)
  }

})

app.get('/logout', (c) => {

  setCookie(c, 'jwt', '', {
      httpOnly: true,
      secure: false, // Use this in production with HTTPs
      sameSite: 'Strict',
      maxAge: 0 
  })

//  return c.html(`
//    <!DOCTYPE html>
//    <html lang="en">
//
//      <head>
//        <meta charset="UTF-8">
//        <meta name="viewport" content="width=device-width, initial-scale=1.0">
//        <title>Logged Out</title>
//      </head>
//
//      <body>
//        <h1>You have been logged out</h1>
//        <a href="/login">Login again</a>
//      </body>
//
//    </html>
//        `)

  let isAjax = false 
  
  if ( c.req.header('X-Alpine-Request') === "true")
    isAjax = true 

  let rendered =""

  if ( isAjax ){
    const logoutFragment = readTemplate('logout')
    return c.html(logoutFragment)

  } else {
    const layout = readTemplate('layout')
    const logoutFragment = readTemplate('logout')
    rendered = Mustache.render(layout, { title: 'Logged Out' }, { content: logoutFragment })

    return c.html(rendered)
  }

})

app.post('login', async (c) => {
  const { username, password } = await c.req.parseBody()

  const stmt = db.prepare('select * from users where username = ?')
  const row = stmt.get(username)

  console.log('row', row) // debug

  // if (username == 'user' && password === 'pass') {
  if (row && row.password === hashPassword(password)) {
    const token = sign({username}, JWT_SECRET, { expiresIn: '1h'} )

    setCookie(c, 'jwt', token, {
      httpOnly: true,
      secure: false, // Use this in production with HTTPs
      sameSite: 'Strict',
      maxAge: 3600 // 1 hour
    })

    return c.redirect('/auth/welcome')
  } else {
    return c.text('Invalid Credentials', 401)
  }
})

// JWT middleware to check for the cookie
const jwtMiddleware = jwt({
  secret: JWT_SECRET,
  cookie: 'jwt' // look for the token cookie 'jwt'
})

// Protected routes
app.use('/auth/*', jwtMiddleware)

app.get('auth/welcome', (c) => {
  const { username } = c.get('jwtPayload')

  // return c.text(`welcome, ${username}!`)
  const layout = readTemplate('layout')
  const welcomeFragment = readTemplate('welcome')
  const rendered = Mustache.render(layout, { title: 'Welcome', username }, { content: welcomeFragment })

  return c.html(rendered)

})

const openAPIApp = new OpenAPIHono() 

openAPIApp.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'jwt',
})

const protectedRoute = createRoute({
  method: 'get',
  path: '/auth',
  security: [{ Bearer: [] }],
  responses: {
    200: {
      description: 'Authorized',
      content: {
        'application/json': {
          schema: z.object({ message: z.string()})
        }
      }
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: z.object({ error: z.string()})
        }
      }
    },
  },
})


openAPIApp.openapi(protectedRoute, (c) => c.json({
  message: 'Hello from hono!'
}))

openAPIApp.doc('/doc', {
  info: {
    title: 'An API',
    version: 'v1'
  },
  openapi: '3.1.0'
})

app.route('/', openAPIApp)

const port = 3000
console.log(`Server is running on port ${port}`)

serve({
  fetch: app.fetch,
  port
})
