# The coil fires: crackle, a falling electric whine and a snap.
with_fx :reverb, room: 0.5, mix: 0.3 do
  use_synth :bnoise
  play 90, release: 0.5, cutoff: 125, amp: 0.7
  use_synth :dsaw
  s = play 88, note_slide: 0.45, release: 0.7, cutoff: 115, detune: 0.3, amp: 0.55
  control s, note: 55
  sleep 0.05
  sample :elec_flip, rate: 1.7, amp: 0.7
  sleep 0.2
  sample :elec_pop, rate: 0.6, amp: 0.5
end
