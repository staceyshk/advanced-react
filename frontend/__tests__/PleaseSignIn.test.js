import { mount } from 'enzyme';
import toJSON from 'enzyme-to-json';
import wait from 'waait';
import PleaseSignIn from '../components/PleaseSignIn';
import { CURRENT_USER_QUERY } from '../components/User';
import { MockedProvider } from 'react-apollo/test-utils';
import { fakeUser } from '../lib/testUtils';

const notSignedInMocks = [
  {
    request: { query: CURRENT_USER_QUERY },
    result: { data: { me: null } },
  },
];

const signedInMocks = [
  {
    request: { query: CURRENT_USER_QUERY },
    result: { data: { me: new fakeUser() } },
  },
];

describe('<PleaseSignIn />', () => {
  it('renders the sign in dialog to logged out users', async () => {
    const wrapper = mount(
      <MockedProvider mocks={notSignedInMocks}>
        <PleaseSignIn />
      </MockedProvider>
    );
    await wait();
    wrapper.update();
    expect(wrapper.text()).toContain('Please Sign in before Continuing');
    const SignIn = wrapper.find('Signin');
    expect(SignIn.exists()).toBe(true);
  });

  it('renders the child component when the user is signed in', async () => {
    const Hey = () => <p>hey!</p>
    const wrapper = mount(
      <MockedProvider mocks={signedInMocks}>
        <PleaseSignIn>
         <Hey />
        </PleaseSignIn>
      </MockedProvider>
    );
    await wait();
    wrapper.update();
    expect(wrapper.contains(<Hey />)).toBe(true);
  });
});