FROM bbyars/mountebank:2.9.1

COPY imposters /imposters

# --allowInjection enables the JS response stub that generates a unique Twilio SID
# per outbound send (so our outbound provider_sid stays unique).
CMD ["start", "--configfile", "/imposters/twilio.json", "--allowInjection", "--host", "0.0.0.0"]
