import ResetPassword from '../components/Reset';

const Reset = props => (
    <ResetPassword resetToken= {props.query.resetToken}/>
);

export default Reset;