import ScrollViewManager from '../NativeModules/ScrollViewManager';
import Platform from '../plugins/Platform';
import Dimensions from '../api/Dimensions';
import DeviceEventEmitter from '../plugins/DeviceEventEmitter';
import React from 'react';
import invariant from 'invariant';
import warning from 'warning';
import TextInputState from '../api/TextInputState';
import Subscribable from './Subscribable';
import UIManager from '../NativeModules/UIManager';

/**
 * Mixin that can be integrated in order to handle scrolling that plays well
 * with `ResponderEventPlugin`. Integrate with your platform specific scroll
 * views, or even your custom built (every-frame animating) scroll views so that
 * all of these systems play well with the `ResponderEventPlugin`.
 *
 * iOS scroll event timing nuances:
 * ===============================
 *
 *
 * Scrolling without bouncing, if you touch down:
 * -------------------------------
 *
 * 1. `onMomentumScrollBegin` (when animation begins after letting up)
 *    ... physical touch starts ...
 * 2. `onTouchStartCapture`   (when you press down to stop the scroll)
 * 3. `onTouchStart`          (same, but bubble phase)
 * 4. `onResponderRelease`    (when lifting up - you could pause forever before * lifting)
 * 5. `onMomentumScrollEnd`
 *
 *
 * Scrolling with bouncing, if you touch down:
 * -------------------------------
 *
 * 1. `onMomentumScrollBegin` (when animation begins after letting up)
 *    ... bounce begins ...
 *    ... some time elapses ...
 *    ... physical touch during bounce ...
 * 2. `onMomentumScrollEnd`   (Makes no sense why this occurs first during bounce)
 * 3. `onTouchStartCapture`   (immediately after `onMomentumScrollEnd`)
 * 4. `onTouchStart`          (same, but bubble phase)
 * 5. `onTouchEnd`            (You could hold the touch start for a long time)
 * 6. `onMomentumScrollBegin` (When releasing the view starts bouncing back)
 *
 * So when we receive an `onTouchStart`, how can we tell if we are touching
 * *during* an animation (which then causes the animation to stop)? The only way
 * to tell is if the `touchStart` occurred immediately after the
 * `onMomentumScrollEnd`.
 *
 * This is abstracted out for you, so you can just call this.scrollResponderIsAnimating() if
 * necessary
 *
 * `ScrollResponder` also includes logic for blurring a currently focused input
 * if one is focused while scrolling. The `ScrollResponder` is a natural place
 * to put this logic since it can support not dismissing the keyboard while
 * scrolling, unless a recognized "tap"-like gesture has occurred.
 *
 * The public lifecycle API includes events for keyboard interaction, responder
 * interaction, and scrolling (among others). The keyboard callbacks
 * `onKeyboardWill/Did/*` are *global* events, but are invoked on scroll
 * responder's props so that you can guarantee that the scroll responder's
 * internal state has been updated accordingly (and deterministically) by
 * the time the props callbacks are invoke. Otherwise, you would always wonder
 * if the scroll responder is currently in a state where it recognizes new
 * keyboard positions etc. If coordinating scrolling with keyboard movement,
 * *always* use these hooks instead of listening to your own global keyboard
 * events.
 *
 * Public keyboard lifecycle API: (props callbacks)
 *
 * Standard Keyboard Appearance Sequence:
 *
 *   this.props.onKeyboardWillShow
 *   this.props.onKeyboardDidShow
 *
 * `onScrollResponderKeyboardDismissed` will be invoked if an appropriate
 * tap inside the scroll responder's scrollable region was responsible
 * for the dismissal of the keyboard. There are other reasons why the
 * keyboard could be dismissed.
 *
 *   this.props.onScrollResponderKeyboardDismissed
 *
 * Standard Keyboard Hide Sequence:
 *
 *   this.props.onKeyboardWillHide
 *   this.props.onKeyboardDidHide
 */

const IS_ANIMATING_TOUCH_START_THRESHOLD_MS = 16;

const ScrollResponderMixin = {
  mixins: [Subscribable.Mixin],
  scrollResponderMixinGetInitialState() {
    return {
      isTouching: false,
      lastMomentumScrollBeginTime: 0,
      lastMomentumScrollEndTime: 0,

      // Reset to false every time becomes responder. This is used to:
      // - Determine if the scroll view has been scrolled and therefore should
      // refuse to give up its responder lock.
      // - Determine if releasing should dismiss the keyboard when we are in
      // tap-to-dismiss mode (!this.props.keyboardShouldPersistTaps).
      observedScrollSinceBecomingResponder: false,
      becameResponderWhileAnimating: false,
    };
  },

  /**
   * Invoke this from an `onScroll` event.
   */
  scrollResponderHandleScrollShouldSetResponder() {
    return this.state.isTouching;
  },

  /**
   * Merely touch starting is not sufficient for a scroll view to become the
   * responder. Being the "responder" means that the very next touch move/end
   * event will result in an action/movement.
   *
   * Invoke this from an `onStartShouldSetResponder` event.
   *
   * `onStartShouldSetResponder` is used when the next move/end will trigger
   * some UI movement/action, but when you want to yield priority to views
   * nested inside of the view.
   *
   * There may be some cases where scroll views actually should return `true`
   * from `onStartShouldSetResponder`: Any time we are detecting a standard tap
   * that gives priority to nested views.
   *
   * - If a single tap on the scroll view triggers an action such as
   *   recentering a map style view yet wants to give priority to interaction
   *   views inside (such as dropped pins or labels), then we would return true
   *   from this method when there is a single touch.
   *
   * - Similar to the previous case, if a two finger "tap" should trigger a
   *   zoom, we would check the `touches` count, and if `>= 2`, we would return
   *   true.
   *
   */
  scrollResponderHandleStartShouldSetResponder() {
    return false;
  },

  /**
   * There are times when the scroll view wants to become the responder
   * (meaning respond to the next immediate `touchStart/touchEnd`), in a way
   * that *doesn't* give priority to nested views (hence the capture phase):
   *
   * - Currently animating.
   * - Tapping anywhere that is not the focused input, while the keyboard is
   *   up (which should dismiss the keyboard).
   *
   * Invoke this from an `onStartShouldSetResponderCapture` event.
   */
  scrollResponderHandleStartShouldSetResponderCapture(e) {
    // First see if we want to eat taps while the keyboard is up
    const currentlyFocusedTextInput = TextInputState.currentlyFocusedField();
    if (!this.props.keyboardShouldPersistTaps &&
      currentlyFocusedTextInput != null &&
      e.target !== currentlyFocusedTextInput) {
      return true;
    }
    return this.scrollResponderIsAnimating();
  },

  /**
   * Invoke this from an `onResponderReject` event.
   *
   * Some other element is not yielding its role as responder. Normally, we'd
   * just disable the `UIScrollView`, but a touch has already began on it, the
   * `UIScrollView` will not accept being disabled after that. The easiest
   * solution for now is to accept the limitation of disallowing this
   * altogether. To improve this, find a way to disable the `UIScrollView` after
   * a touch has already started.
   */
  scrollResponderHandleResponderReject() {
    warning(false, "ScrollView doesn't take rejection well - scrolls anyway");
  },

  /**
   * We will allow the scroll view to give up its lock iff it acquired the lock
   * during an animation. This is a very useful default that happens to satisfy
   * many common user experiences.
   *
   * - Stop a scroll on the left edge, then turn that into an outer view's
   *   backswipe.
   * - Stop a scroll mid-bounce at the top, continue pulling to have the outer
   *   view dismiss.
   * - However, without catching the scroll view mid-bounce (while it is
   *   motionless), if you drag far enough for the scroll view to become
   *   responder (and therefore drag the scroll view a bit), any backswipe
   *   navigation of a swipe gesture higher in the view hierarchy, should be
   *   rejected.
   */
  scrollResponderHandleTerminationRequest() {
    return !this.state.observedScrollSinceBecomingResponder;
  },

  /**
   * Invoke this from an `onTouchEnd` event.
   *
   * @param {SyntheticEvent} e Event.
   */
  scrollResponderHandleTouchEnd(e) {
    const nativeEvent = e.nativeEvent;
    this.state.isTouching = nativeEvent.touches.length !== 0;
    if (this.props.onTouchEnd) {
      this.props.onTouchEnd(e);
    }
  },

  /**
   * Invoke this from an `onResponderRelease` event.
   */
  scrollResponderHandleResponderRelease(e) {
    if (this.props.onResponderRelease) {
      this.props.onResponderRelease(e);
    }

    // By default scroll views will unfocus a textField
    // if another touch occurs outside of it
    const currentlyFocusedTextInput = TextInputState.currentlyFocusedField();
    if (!this.props.keyboardShouldPersistTaps &&
      currentlyFocusedTextInput != null &&
      e.target !== currentlyFocusedTextInput &&
      !this.state.observedScrollSinceBecomingResponder &&
      !this.state.becameResponderWhileAnimating) {
      if (this.props.onScrollResponderKeyboardDismissed) {
        this.props.onScrollResponderKeyboardDismissed(e);
      }
      TextInputState.blurTextInput(currentlyFocusedTextInput);
    }
  },

  scrollResponderHandleScroll(e) {
    this.state.observedScrollSinceBecomingResponder = true;
    if (this.props.onScroll) {
      this.props.onScroll(e);
    }
  },

  /**
   * Invoke this from an `onResponderGrant` event.
   */
  scrollResponderHandleResponderGrant(e) {
    this.state.observedScrollSinceBecomingResponder = false;
    if (this.props.onResponderGrant) {
      this.props.onResponderGrant(e);
    }
    this.state.becameResponderWhileAnimating = this.scrollResponderIsAnimating();
  },

  /**
   * Unfortunately, `onScrollBeginDrag` also fires when *stopping* the scroll
   * animation, and there's not an easy way to distinguish a drag vs. stopping
   * momentum.
   *
   * Invoke this from an `onScrollBeginDrag` event.
   */
  scrollResponderHandleScrollBeginDrag(e) {
    if (this.props.onScrollBeginDrag) {
      this.props.onScrollBeginDrag(e);
    }
  },

  /**
   * Invoke this from an `onScrollEndDrag` event.
   */
  scrollResponderHandleScrollEndDrag(e) {
    if (this.props.onScrollEndDrag) {
      this.props.onScrollEndDrag(e);
    }
  },

  /**
   * Invoke this from an `onMomentumScrollBegin` event.
   */
  scrollResponderHandleMomentumScrollBegin(e) {
    this.state.lastMomentumScrollBeginTime = Date.now();
    if (this.props.onMomentumScrollBegin) {
      this.props.onMomentumScrollBegin(e);
    }
  },

  /**
   * Invoke this from an `onMomentumScrollEnd` event.
   */
  scrollResponderHandleMomentumScrollEnd(e) {
    this.state.lastMomentumScrollEndTime = Date.now();
    if (this.props.onMomentumScrollEnd) {
      this.props.onMomentumScrollEnd(e);
    }
  },

  /**
   * Invoke this from an `onTouchStart` event.
   *
   * Since we know that the `SimpleEventPlugin` occurs later in the plugin
   * order, after `ResponderEventPlugin`, we can detect that we were *not*
   * permitted to be the responder (presumably because a contained view became
   * responder). The `onResponderReject` won't fire in that case - it only
   * fires when a *current* responder rejects our request.
   *
   * @param {SyntheticEvent} e Touch Start event.
   */
  scrollResponderHandleTouchStart(e) {
    this.state.isTouching = true;
    if (this.props.onTouchStart) {
      this.props.onTouchStart(e);
    }
  },

  /**
   * Invoke this from an `onTouchMove` event.
   *
   * Since we know that the `SimpleEventPlugin` occurs later in the plugin
   * order, after `ResponderEventPlugin`, we can detect that we were *not*
   * permitted to be the responder (presumably because a contained view became
   * responder). The `onResponderReject` won't fire in that case - it only
   * fires when a *current* responder rejects our request.
   *
   * @param {SyntheticEvent} e Touch Start event.
   */
  scrollResponderHandleTouchMove(e) {
    if (this.props.onTouchMove) {
      this.props.onTouchMove(e);
    }
  },

  /**
   * A helper function for this class that lets us quickly determine if the
   * view is currently animating. This is particularly useful to know when
   * a touch has just started or ended.
   */
  scrollResponderIsAnimating() {
    const now = Date.now();
    const timeSinceLastMomentumScrollEnd = now - this.state.lastMomentumScrollEndTime;
    const isAnimating = timeSinceLastMomentumScrollEnd < IS_ANIMATING_TOUCH_START_THRESHOLD_MS ||
      this.state.lastMomentumScrollEndTime < this.state.lastMomentumScrollBeginTime;
    return isAnimating;
  },

  /**
   * A helper function to scroll to a specific point  in the scrollview.
   * This is currently used to help focus on child textviews, but this
   * can also be used to quickly scroll to any element we want to focus
   */
  scrollResponderScrollTo(offsetX, offsetY, animated = true) {

  },

  /**
   * A helper function to zoom to a specific rect in the scrollview.
   * @param {object} rect Should have shape {x, y, width, height}
   * @param {bool} animated Specify whether zoom is instant or animated
   */
  scrollResponderZoomTo(rect, animated = true) {
    if (Platform.OS === 'android') {
      invariant('zoomToRect is not implemented');
    } else {
      ScrollViewManager.zoomToRect(React.findNodeHandle(this), rect, animated);
    }
  },

  /**
   * This method should be used as the callback to onFocus in a TextInputs'
   * parent view. Note that any module using this mixin needs to return
   * the parent view's ref in getScrollViewRef() in order to use this method.
   * @param {any} nodeHandle The TextInput node handle
   * @param {number} additionalOffset The scroll view's top "contentInset".
   *        Default is 0.
   * @param {bool} preventNegativeScrolling Whether to allow pulling the content
   *        down to make it meet the keyboard's top. Default is false.
   */
  scrollResponderScrollNativeHandleToKeyboard(
    nodeHandle,
    additionalOffset,
    preventNegativeScrollOffset) {
    this.additionalScrollOffset = additionalOffset || 0;
    this.preventNegativeScrollOffset = !!preventNegativeScrollOffset;
    UIManager.measureLayout(
      nodeHandle,
      React.findNodeHandle(this.getInnerViewNode()),
      this.scrollResponderTextInputFocusError,
      this.scrollResponderInputMeasureAndScrollToKeyboard
    );
  },

  /**
   * The calculations performed here assume the scroll view takes up the entire
   * screen - even if has some content inset. We then measure the offsets of the
   * keyboard, and compensate both for the scroll view's "contentInset".
   *
   * @param {number} left Position of input w.r.t. table view.
   * @param {number} top Position of input w.r.t. table view.
   * @param {number} width Width of the text input.
   * @param {number} height Height of the text input.
   */
  scrollResponderInputMeasureAndScrollToKeyboard(left, top, width, height) {
    let keyboardScreenY = Dimensions.get('window').height;
    if (this.keyboardWillOpenTo) {
      keyboardScreenY = this.keyboardWillOpenTo.endCoordinates.screenY;
    }
    let scrollOffsetY = top - keyboardScreenY + height + this.additionalScrollOffset;

    // By default, this can scroll with negative offset, pulling the content
    // down so that the target component's bottom meets the keyboard's top.
    // If requested otherwise, cap the offset at 0 minimum to avoid content
    // shifting down.
    if (this.preventNegativeScrollOffset) {
      scrollOffsetY = Math.max(0, scrollOffsetY);
    }
    this.scrollResponderScrollTo(0, scrollOffsetY);

    this.additionalOffset = 0;
    this.preventNegativeScrollOffset = false;
  },

  scrollResponderTextInputFocusError(e) {
    console.error('Error measuring text field: ', e);
  },

  /**
   * `componentWillMount` is the closest thing to a  standard "constructor" for
   * React components.
   *
   * The `keyboardWillShow` is called before input focus.
   */
  // componentWillMount() {
  //   this.keyboardWillOpenTo = null;
  //   this.additionalScrollOffset = 0;
  //   this.addListenerOn(
  //     DeviceEventEmitter, 'keyboardWillShow', this.scrollResponderKeyboardWillShow
  //   );
  //   this.addListenerOn(
  //     DeviceEventEmitter, 'keyboardWillHide', this.scrollResponderKeyboardWillHide
  //   );
  //   this.addListenerOn(DeviceEventEmitter, 'keyboardDidShow', this.scrollResponderKeyboardDidShow);
  //   this.addListenerOn(DeviceEventEmitter, 'keyboardDidHide', this.scrollResponderKeyboardDidHide);
  // },

  componentWillUnmount() {
    DeviceEventEmitter.removeListener('keyboardWillShow', this.scrollResponderKeyboardWillShow);
    DeviceEventEmitter.removeListener('keyboardWillHide', this.scrollResponderKeyboardWillHide);
    DeviceEventEmitter.removeListener('keyboardDidShow', this.scrollResponderKeyboardDidShow);
    DeviceEventEmitter.removeListener('keyboardDidHide', this.scrollResponderKeyboardDidHide);
  },

  /**
   * Warning, this may be called several times for a single keyboard opening.
   * It's best to store the information in this method and then take any action
   * at a later point (either in `keyboardDidShow` or other).
   *
   * Here's the order that events occur in:
   * - focus
   * - willShow {startCoordinates, endCoordinates} several times
   * - didShow several times
   * - blur
   * - willHide {startCoordinates, endCoordinates} several times
   * - didHide several times
   *
   * The `ScrollResponder` providesModule callbacks for each of these events.
   * Even though any user could have easily listened to keyboard events
   * themselves, using these `props` callbacks ensures that ordering of events
   * is consistent - and not dependent on the order that the keyboard events are
   * subscribed to. This matters when telling the scroll view to scroll to where
   * the keyboard is headed - the scroll responder better have been notified of
   * the keyboard destination before being instructed to scroll to where the
   * keyboard will be. Stick to the `ScrollResponder` callbacks, and everything
   * will work.
   *
   * WARNING: These callbacks will fire even if a keyboard is displayed in a
   * different navigation pane. Filter out the events to determine if they are
   * relevant to you. (For example, only if you receive these callbacks after
   * you had explicitly focused a node etc).
   */
  scrollResponderKeyboardWillShow(e) {
    this.keyboardWillOpenTo = e;
    if (this.props.onKeyboardWillShow) {
      this.props.onKeyboardWillShow(e);
    }
  },

  scrollResponderKeyboardWillHide(e) {
    this.keyboardWillOpenTo = null;
    if (this.props.onKeyboardWillHide) {
      this.props.onKeyboardWillHide(e);
    }
  },

  scrollResponderKeyboardDidShow(e) {
    // TODO(7693961): The event for DidShow is not available on iOS yet.
    // Use the one from WillShow and do not assign.
    if (e) {
      this.keyboardWillOpenTo = e;
    }
    if (this.props.onKeyboardDidShow) {
      this.props.onKeyoardDidShow(e);
    }
  },

  scrollResponderKeyboardDidHide(e) {
    this.keyboardWillOpenTo = null;
    if (this.props.onKeyboardDidHide) {
      this.props.onKeyboardDidHide(e);
    }
  }
};

const ScrollResponder = {
  Mixin: ScrollResponderMixin,
};

module.exports = ScrollResponder;
