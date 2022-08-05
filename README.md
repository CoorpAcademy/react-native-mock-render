# another fork ?

Root App doesn't maintain its fork anymore, and we at Coorpacademy need to update Mocks as React Native goes further.

# react-native-mock-render

A fork of [react-native-mock](https://github.com/RealOrangeOne/react-native-mock) that renders components

## Requirements

- Node.js 16+
- The latest version of react-native

## Installation

```bash
npm i @coorpacademy/react-native-mock-render --save-dev
```

```js
/* file-that-runs-before-all-of-my-tests.js */

// This will mutate `react-native`'s require cache with `react-native-mock`'s.
require('@coorpacademy/react-native-mock-render/mock')(); // <-- side-effects!!!
```

## Eternal libs

to mock optional external libs, use:

```js
require('@coorpacademy/react-native-mock-render/mock')({
  externalLibs: [
    {
      name: 'react-native-lib-with-many-exports',
      exports: ['ComponentA', 'ComponentB', 'ComponentC']
    },
    {
      name: 'react-native-lib-with-default-export',
      exports: 'ImportName'
    },
    {
      name: 'react-native-modal',
      exports: 'Modal'
    }
  ]
});

```

### Jest

Jest [doesn't support](https://github.com/Root-App/react-native-mock-render/issues/23) `require.cache`, so the correct way to do the mocking is using `jest.mock('react-native', () => require('react-native-mock-render'), {virtual: true})` in your tests setup file.

## Why?

We wanted to be able deeply render React Native components in our integration tests and already used `react-native-mock`.

### Contributors

- [Coorpacademy's Dev Team](https://coorpacademy.com)
- [Root Insurance's Dev Team](https://joinroot.com)

### [react-native-mock](https://github.com/RealOrangeOne/react-native-mock) Core Contributors

- [Jake Howard](https://github.com/RealOrangeOne)
- [Leland Richardson](https://github.com/lelandrichardson) (Original Creator)
