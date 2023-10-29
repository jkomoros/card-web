declare module 'nodemailer-postmark-transport' {
    //eslint-disable-next-line @typescript-eslint/no-explicit-any
    export default function postmarkTransport(_args: {auth: {apiKey: string}}) : any;
}