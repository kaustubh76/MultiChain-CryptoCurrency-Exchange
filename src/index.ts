import express, {
  type Request,
  type Response,
  type NextFunction
} from 'express'
import dotenv from 'dotenv'
import { createTable } from './database'
import UserRoutes from './routes/Users'
import DatabaseRoutes from './routes/Database'
import Logging from './library/Logging'
import verifyToken from './middlewares/verifyToken'
import cron from 'node-cron'
import {
  listenToAllEvents,
  processFailedTransactions,
  processPendingEvents
} from './helper/eventListener'

// Load environment variables
dotenv.config()

// This function starts the server, it is called after the database is connected
const startServer = (): void => {
  // Create express app
  const app = express()
  const port = process.env.PORT ?? 3000

  app.use(express.urlencoded({ extended: true }))
  app.use(express.json())

  // This middleware logs the incoming and outgoing requests and their duration
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Capture start time
    const start = process.hrtime()

    Logging.info(
      `Incoming -> Method: [${req.method}] - URL: [${req.url}] - IP: [${req.socket.remoteAddress}]`
    )

    res.on('finish', () => {
      // Calculate elapsed time
      const [seconds, nanoseconds] = process.hrtime(start)
      const milliseconds = seconds * 1000 + nanoseconds / 1e6

      Logging.info(
        `Outgoing -> Method: [${req.method}] - URL: [${req.url}] - IP: [${
          req.socket.remoteAddress
        }] - Status: [${res.statusCode}] - Duration: [${milliseconds.toFixed(
          2
        )} ms]`
      )
    })

    next()
  })

  // Routes
  // All requests to /users are handled by the UserRoutes
  app.use('/users', UserRoutes)
  // All requests to /database are handled by the DatabaseRoutes
  // but first we verify the token using the verifyToken middleware
  app.use('/database', verifyToken, DatabaseRoutes)

  /** Health Check */
  app.get('/ping', (req, res, next) => {
    return res.status(200).json({ message: 'pong' })
  })

  // parallel processing of pending events
  processPendingEvents().catch(Logging.error)
  // Listen to the USDC contract on Optimism
  listenToAllEvents()

  // Setup cron job to run every 2 minutes to process failed transactions
  cron.schedule('*/2 * * * *', () => {
    processFailedTransactions().catch(Logging.error)
    Logging.warn('Running cron job to process failed transactions')
  })

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
  })
}

// Call the function to create the tables in the PostgreSQL database
// once the tables are created, start the server
createTable().then(startServer).catch(Logging.error)
