import { describe } from 'node:test'
import { scenario } from './scenario.mjs'

// Skipped, and visibly so, without a server: a skip is reported as one.
const url = process.env.PGSQL_TEST_URL
if (url) process.env.DB_URL = url
describe('postgres', { skip: url ? false : 'PGSQL_TEST_URL is not set' }, () => scenario('postgres'))
