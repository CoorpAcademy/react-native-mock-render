/**
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

import React from 'react';
import ViewPropTypes from '../propTypes/ViewPropTypes';

/**
 * Renders nested content and automatically applies paddings reflect the portion of the view
 * that is not covered by navigation bars, tab bars, toolbars, and other ancestor views.
 * Moreover, and most importantly, Safe Area's paddings reflect physical limitation of the screen,
 * such as rounded corners or camera notches (aka sensor housing area on iPhone X).
 */
class SafeAreaView extends React.Component {
  static propTypes = {
    ...ViewPropTypes
  };

  render() {
    return React.createElement('react-native-mock', this.props, this.props.children);
  }
}

module.exports = SafeAreaView;
