import { debug } from '../src/util'

const actionsCore = require('@actions/core')
jest.mock('@actions/core')

test('debug on via isDebug', () => {
  actionsCore.isDebug.mockReturnValue(true)
  actionsCore.getInput.mockReturnValue('')
  expect(debug()).toBe(true)
})

test('debug on via debug input', () => {
  actionsCore.getInput.mockImplementation((name: string) => (name === 'debug' ? 'true' : 'false'))
  expect(debug()).toBe(true)
})

test('debug off by default', () => {
  actionsCore.isDebug.mockReturnValue(false)
  actionsCore.getInput.mockReturnValue('')
  expect(debug()).toBe(false)
})
